/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { WebSiteManagementMappers } from '@azure/arm-appservice';
import * as extract from 'extract-zip';
import * as vscode from 'vscode';
import { registerAppServiceExtensionVariables } from 'vscode-azureappservice';
import { AzExtTreeDataProvider, AzureUserInput, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, registerEvent, registerUIExtensionVariables } from 'vscode-azureextensionui';
// tslint:disable-next-line:no-submodule-imports
import { AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { createFunctionFromApi } from './commands/api/createFunctionFromApi';
import { downloadAppSettingsFromApi } from './commands/api/downloadAppSettingsFromApi';
import { revealTreeItem } from './commands/api/revealTreeItem';
import { uploadAppSettingsFromApi } from './commands/api/uploadAppSettingsFromApi';
import { runPostFunctionCreateStepsFromCache } from './commands/createFunction/FunctionCreateStepBase';
import { initProjectForVSCode } from './commands/initProjectForVSCode/initProjectForVSCode';
import { registerCommands } from './commands/registerCommands';
import { func, ProjectLanguage } from './constants';
import { AzureAccount } from './debug/AzureAccountExtension.api';
import { FuncTaskProvider } from './debug/FuncTaskProvider';
import { JavaDebugProvider } from './debug/JavaDebugProvider';
import { NodeDebugProvider } from './debug/NodeDebugProvider';
import { PowerShellDebugProvider } from './debug/PowerShellDebugProvider';
import { PythonDebugProvider } from './debug/PythonDebugProvider';
import { ext } from './extensionVariables';
import { registerFuncHostTaskEvents } from './funcCoreTools/funcHostTask';
import { validateFuncCoreToolsIsLatest } from './funcCoreTools/validateFuncCoreToolsIsLatest';
import { CentralTemplateProvider } from './templates/CentralTemplateProvider';
import { AzureAccountTreeItemWithProjects } from './tree/AzureAccountTreeItemWithProjects';
import { getNameFromId } from './utils/azure';
import { requestUtils } from './utils/requestUtils';
import { AzureFunctionsExtensionApi } from './vscode-azurefunctions.api';
import { verifyVSCodeConfigOnActivate } from './vsCodeConfig/verifyVSCodeConfigOnActivate';

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number; loadEndTime: number }, ignoreBundle?: boolean): Promise<AzureExtensionApiProvider> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;
    ext.outputChannel = createAzExtOutputChannel('Azure Functions', ext.prefix);
    context.subscriptions.push(ext.outputChannel);
    ext.ui = new AzureUserInput(context.globalState);
    const projectFilePath: string = '';
    const language: ProjectLanguage = ProjectLanguage.PowerShell;

    const azureAccountExt = vscode.extensions.getExtension<AzureAccount>("ms-vscode.azure-account");

    registerUIExtensionVariables(ext);
    registerAppServiceExtensionVariables(ext);
    vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri): void {
            vscode.window.showInformationMessage('handle uri called');
            ext.context.globalState.update("isHackathon", true);
            // tslint:disable-next-line:no-unexternalized-strings
            azureAccountExt?.activate().then(account => {
                vscode.window.showInformationMessage('activated the account ext');
                vscode.commands.executeCommand('azure-account.login').then(() => {
                    return account.sessions[0].credentials2.getToken().then(tokenResponse => {
                        vscode.window.showInformationMessage('got the token');
                        vscode.window.showInputBox({ prompt: "Enter folder path for local project", ignoreFocusOut: true, value: 'f:\\temp' }).then((filePath: string) => {
                            // tslint:disable-next-line:no-unexternalized-strings
                            //vscode.window.showInputBox({ prompt: "Enter Bearer token", ignoreFocusOut: true }).then((token: string) => {
                            setupLocalProjectFolder(uri, filePath, tokenResponse.accessToken, projectFilePath);
                            //});
                        });
                    });
                });
            });
        }
    });

    await callWithTelemetryAndErrorHandling('azureFunctions.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        runPostFunctionCreateStepsFromCache();

        // tslint:disable-next-line:no-floating-promises
        validateFuncCoreToolsIsLatest();

        ext.azureAccountTreeItem = new AzureAccountTreeItemWithProjects();
        context.subscriptions.push(ext.azureAccountTreeItem);
        ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'azureFunctions.loadMore');
        ext.treeView = vscode.window.createTreeView('azFuncTree', { treeDataProvider: ext.tree, showCollapseAll: true });
        context.subscriptions.push(ext.treeView);

        const validateEventId: string = 'azureFunctions.validateFunctionProjects';
        // tslint:disable-next-line:no-floating-promises
        callWithTelemetryAndErrorHandling(validateEventId, async (actionContext: IActionContext) => {
            if (!ext.context.globalState.get("isHackathon")) {
                await verifyVSCodeConfigOnActivate(actionContext, vscode.workspace.workspaceFolders);
            } else {
                await initProjectForVSCode(actionContext, projectFilePath, language);
                ext.context.globalState.update("isHackathon", false);
            }
        });
        registerEvent(validateEventId, vscode.workspace.onDidChangeWorkspaceFolders, async (actionContext: IActionContext, event: vscode.WorkspaceFoldersChangeEvent) => {
            await verifyVSCodeConfigOnActivate(actionContext, event.added);
        });

        ext.templateProvider = new CentralTemplateProvider();

        registerCommands();

        registerFuncHostTaskEvents();

        const nodeDebugProvider: NodeDebugProvider = new NodeDebugProvider();
        const pythonDebugProvider: PythonDebugProvider = new PythonDebugProvider();
        const javaDebugProvider: JavaDebugProvider = new JavaDebugProvider();
        const powershellDebugProvider: PowerShellDebugProvider = new PowerShellDebugProvider();

        // These don't actually overwrite "node", "python", etc. - they just add to it
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('node', nodeDebugProvider));
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('python', pythonDebugProvider));
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('java', javaDebugProvider));
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('PowerShell', powershellDebugProvider));
        context.subscriptions.push(vscode.workspace.registerTaskProvider(func, new FuncTaskProvider(nodeDebugProvider, pythonDebugProvider, javaDebugProvider, powershellDebugProvider)));

        // Temporary workaround so that "powerShellVersion" is an allowed property on SiteConfig
        // https://github.com/Azure/azure-sdk-for-js/issues/10552
        // tslint:disable-next-line: no-non-null-assertion
        WebSiteManagementMappers.SiteConfig.type.modelProperties!.powerShellVersion = { serializedName: 'powerShellVersion', type: { name: 'String' } };
        // tslint:disable-next-line: no-non-null-assertion
        WebSiteManagementMappers.SiteConfigResource.type.modelProperties!.powerShellVersion = { serializedName: 'properties.powerShellVersion', type: { name: 'String' } };
    });

    return createApiProvider([<AzureFunctionsExtensionApi>{
        revealTreeItem,
        createFunction: createFunctionFromApi,
        downloadAppSettings: downloadAppSettingsFromApi,
        uploadAppSettings: uploadAppSettingsFromApi,
        apiVersion: '1.3.0'
    }]);
}

// tslint:disable-next-line:no-empty
export function deactivateInternal(): void {
}

function setupLocalProjectFolder(uri: vscode.Uri, filePath: string, token: string, projectFilePath: string): void {
    const queryParts: string[] = uri.query.split('&');
    const resourceId: string = queryParts[0].split('=')[1];
    const devContainerName: string = queryParts[1].split('=')[1];
    const functionAppName: string = getNameFromId(resourceId);
    const url: string = `https://${functionAppName}.scm.azurewebsites.net/api/functions/admin/download?includeCsproj=true&includeAppSettings=true`;
    // tslint:disable-next-line:no-any
    const headers: { [key: string]: any } = { Authorization: `Bearer ${token}` };
    const downloadFilePath: string = `${filePath}\\${functionAppName}.zip`;
    const folderName: string = downloadFilePath.split('\\')[2].split('.')[0];
    // tslint:disable-next-line: no-floating-promises
    requestUtils.downloadFile(url, downloadFilePath, headers).then(() => {
        vscode.window.showInformationMessage('Download done');
        projectFilePath = `${filePath}\\${folderName}\\`;
        // tslint:disable-next-line: no-unsafe-any
        extract(downloadFilePath, { dir: projectFilePath }, (_err: Error) => {
            vscode.window.showInformationMessage('Extract files done');
            // tslint:disable-next-line: no-floating-promises
            const downloadDevContainerPath: string = `${filePath}\\master.zip`;
            // tslint:disable-next-line: no-floating-promises
            requestUtils.downloadFile(
                'https://github.com/microsoft/vscode-dev-containers/archive/master.zip',
                downloadDevContainerPath
            ).then(() => {
                vscode.window.showInformationMessage('Download of dev containers done');
                const devContainerfolderName: string = downloadDevContainerPath.split('\\')[2].split('.')[0];
                // tslint:disable-next-line: no-unsafe-any
                extract(downloadDevContainerPath, { dir: `${filePath}\\${devContainerfolderName}\\` }, (_err1: Error) => {
                    vscode.window.showInformationMessage('Extract dev container files done');
                    vscode.workspace.fs.copy(
                        vscode.Uri.file(`${filePath}\\${devContainerfolderName}\\vscode-dev-containers-master\\containers\\${devContainerName}\\.devcontainer\\`),
                        vscode.Uri.file(`${projectFilePath}.devcontainer`),
                        {
                            overwrite: true
                        }
                    );

                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectFilePath));
                });
            });
        });
    });
}
