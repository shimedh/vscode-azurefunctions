/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fse from 'fs-extra';
import { IHookCallbackContext, ISuiteCallbackContext } from 'mocha';
import * as vscode from 'vscode';
import { getRandomHexString, isWindows, ProjectLanguage, requestUtils } from '../../extension.bundle';
import { longRunningTestsEnabled, testUserInput, testWorkspacePath } from '../global.test';
import { getCSharpValidateOptions, getJavaScriptValidateOptions, getPowerShellValidateOptions, getPythonValidateOptions, getTypeScriptValidateOptions, IValidateProjectOptions, validateProject } from '../validateProject';
import { resourceGroupsToDelete } from './global.nightly.test';

suite('Create Project and Deploy', async function (this: ISuiteCallbackContext): Promise<void> {
    this.timeout(10 * 60 * 1000);

    suiteSetup(async function (this: IHookCallbackContext): Promise<void> {
        if (!longRunningTestsEnabled) {
            this.skip();
        }
    });

    test('JavaScript', async () => {
        const authLevel: string = 'Function';
        await testCreateProjectAndDeploy([authLevel], getJavaScriptValidateOptions(true), ProjectLanguage.JavaScript);
    });

    test('JavaScript - Linux Dedicated', async () => {
        const authLevel: string = 'Anonymous';
        await testCreateProjectAndDeploy([authLevel], getJavaScriptValidateOptions(true), ProjectLanguage.JavaScript, 'JavaScript');
    });

    test('TypeScript', async () => {
        const authLevel: string = 'Anonymous';
        await testCreateProjectAndDeploy([authLevel], getTypeScriptValidateOptions(), ProjectLanguage.TypeScript);
    });

    test('CSharp', async () => {
        const namespace: string = 'Company.Function';
        const accessRights: string = 'Anonymous';
        await testCreateProjectAndDeploy([namespace, accessRights], getCSharpValidateOptions('testWorkspace', 'netcoreapp2.1'), ProjectLanguage.CSharp);
    });

    test('CSharp - Linux Dedicated', async () => {
        const namespace: string = 'Company.Function';
        const accessRights: string = 'Admin';
        await testCreateProjectAndDeploy([namespace, accessRights], getCSharpValidateOptions('testWorkspace', 'netcoreapp2.1'), ProjectLanguage.CSharp, '.NET');
    });

    test('PowerShell', async () => {
        const authLevel: string = 'Function';
        await testCreateProjectAndDeploy([authLevel], getPowerShellValidateOptions(), ProjectLanguage.PowerShell);
    });

    test('Python', async function (this: IHookCallbackContext): Promise<void> {
        // Disabling on Windows until we can get it to work
        if (isWindows) {
            this.skip();
        }

        const authLevel: string = 'Function';
        await testCreateProjectAndDeploy([authLevel], getPythonValidateOptions('testWorkspace', '.venv'), ProjectLanguage.Python);
    });

    test('Python - Linux Dedicated', async function (this: IHookCallbackContext): Promise<void> {
        // Disabling on Windows until we can get it to work
        if (isWindows) {
            this.skip();
        }

        const authLevel: string = 'Anonymous';
        await testCreateProjectAndDeploy([authLevel], getPythonValidateOptions('testWorkspace', '.venv'), ProjectLanguage.Python, 'Python');
    });
});

async function testCreateProjectAndDeploy(functionInputs: (RegExp | string)[], validateProjectOptions: IValidateProjectOptions, projectLanguage: ProjectLanguage, linuxDedicatedRuntime?: string): Promise<void> {
    const functionName: string = 'func' + getRandomHexString(); // function name must start with a letter
    await fse.emptyDir(testWorkspacePath);
    await testUserInput.runWithInputs([testWorkspacePath, projectLanguage, /http\s*trigger/i, functionName, ...functionInputs], async () => {
        await vscode.commands.executeCommand('azureFunctions.createNewProject');
    });
    // tslint:disable-next-line: strict-boolean-expressions
    validateProjectOptions.excludedPaths = validateProjectOptions.excludedPaths || [];
    validateProjectOptions.excludedPaths.push('.git'); // Since the workspace is already in a git repo
    await validateProject(testWorkspacePath, validateProjectOptions);

    const appName: string = linuxDedicatedRuntime ? await deployLinuxDedicated(linuxDedicatedRuntime) : await deployBasic();
    await validateFunctionUrl(appName, functionName, projectLanguage);
}

async function deployBasic(): Promise<string> {
    const appName: string = 'funcBasic' + getRandomHexString();
    resourceGroupsToDelete.push(appName);
    await testUserInput.runWithInputs([/create new function app/i, appName, 'West US'], async () => {
        await vscode.commands.executeCommand('azureFunctions.deploy');
    });
    return appName;
}

async function deployLinuxDedicated(runtime: string): Promise<string> {
    const appName: string = getRandomHexString();
    const planName: string = getRandomHexString();
    const rgName: string = 'funcLinuxDed' + getRandomHexString();
    const saName: string = getRandomHexString().toLowerCase();
    const aiName: string = getRandomHexString();

    resourceGroupsToDelete.push(rgName);
    const testInputs: (string | RegExp)[] = [/advanced/i, appName, 'Linux', 'App Service Plan', /create.*plan/i, planName, 'B1', runtime, /create.*group/i, rgName, /create.*storage/i, saName, /create.*insights/i, aiName, 'West US'];
    await testUserInput.runWithInputs(testInputs, async () => {
        await vscode.commands.executeCommand('azureFunctions.deploy');
    });
    return appName;
}

async function validateFunctionUrl(appName: string, functionName: string, projectLanguage: ProjectLanguage): Promise<void> {
    const inputs: (string | RegExp)[] = [appName, functionName];
    if (projectLanguage !== ProjectLanguage.CSharp) { // CSharp doesn't support local project tree view
        inputs.unshift(/^((?!Local Project).)*$/i); // match any item except local project
    }

    await vscode.env.clipboard.writeText(''); // Clear the clipboard
    await testUserInput.runWithInputs(inputs, async () => {
        await vscode.commands.executeCommand('azureFunctions.copyFunctionUrl');
    });
    const functionUrl: string = await vscode.env.clipboard.readText();

    const request: requestUtils.Request = await requestUtils.getDefaultRequest(functionUrl);
    request.body = { name: "World" };
    request.json = true;
    const response: string = await requestUtils.sendRequest(request);
    assert.ok(response.includes('Hello') && response.includes('World'), 'Expected function response to include "Hello" and "World"');
}