/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HttpOperationResponse, RequestPrepareOptions, ServiceClient, WebResource } from "@azure/ms-rest-js";
import * as fse from 'fs-extra';
import * as path from 'path';
import { createGenericClient, parseError } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { localize } from '../localize';
import { getWorkspaceSetting } from "../vsCodeConfig/settings";
import { nonNullProp } from "./nonNull";

export namespace requestUtils {
    const timeoutKey: string = 'requestTimeout';

    export async function sendRequestWithTimeout(options: RequestPrepareOptions): Promise<HttpOperationResponse> {
        let request: WebResource = new WebResource();
        request = request.prepare(options);

        const timeoutSeconds: number | undefined = getWorkspaceSetting(timeoutKey);
        if (timeoutSeconds !== undefined) {
            request.timeout = timeoutSeconds * 1000;
        }

        try {
            const client: ServiceClient = await createGenericClient();
            return await client.sendRequest(request);
        } catch (error) {
            if (parseError(error).errorType === 'REQUEST_ABORTED_ERROR') {
                throw new Error(localize('timeoutFeed', 'Request timed out. Modify setting "{0}.{1}" if you want to extend the timeout.', ext.prefix, timeoutKey));
            } else {
                throw error;
            }
        }
    }

    export async function downloadFile(url: string, filePath: string): Promise<void> {
        await fse.ensureDir(path.dirname(filePath));
        const request: WebResource = new WebResource();
        request.prepare({ method: 'GET', url, headers: {"Authorization": "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6ImtnMkxZczJUMENUaklmajRydDZKSXluZW4zOCIsImtpZCI6ImtnMkxZczJUMENUaklmajRydDZKSXluZW4zOCJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQuY29yZS53aW5kb3dzLm5ldC8iLCJpc3MiOiJodHRwczovL3N0cy53aW5kb3dzLm5ldC83MmY5ODhiZi04NmYxLTQxYWYtOTFhYi0yZDdjZDAxMWRiNDcvIiwiaWF0IjoxNjAzMjMxMzI2LCJuYmYiOjE2MDMyMzEzMjYsImV4cCI6MTYwMzIzNTIyNiwiX2NsYWltX25hbWVzIjp7Imdyb3VwcyI6InNyYzEifSwiX2NsYWltX3NvdXJjZXMiOnsic3JjMSI6eyJlbmRwb2ludCI6Imh0dHBzOi8vZ3JhcGgud2luZG93cy5uZXQvNzJmOTg4YmYtODZmMS00MWFmLTkxYWItMmQ3Y2QwMTFkYjQ3L3VzZXJzLzVhYmJjNDQ1LWFkMGYtNDUxNi04MTNhLTYxMDY5OTI1NzU5Mi9nZXRNZW1iZXJPYmplY3RzIn19LCJhY3IiOiIxIiwiYWlvIjoiQVZRQXEvOFJBQUFBbFlCRnJ3Q2QwLzJyeDV1SGhaUXA3ZjBqQ0lSQnBDYXRETjVwU3NqU3RMZHF6UXlvR25mOGE0L2xQamt2dm5wYzV2UW1EcHFaY0VtZDZDazlCWlpvemYxanl0cVNCR3ppRXZOaTJEM2RXNzg9IiwiYW1yIjpbInB3ZCIsIm1mYSJdLCJhcHBpZCI6ImM0NGI0MDgzLTNiYjAtNDljMS1iNDdkLTk3NGU1M2NiZGYzYyIsImFwcGlkYWNyIjoiMiIsImZhbWlseV9uYW1lIjoiTWVkaGVrYXIiLCJnaXZlbl9uYW1lIjoiU2hpYmFuaSIsImluX2NvcnAiOiJ0cnVlIiwiaXBhZGRyIjoiMTMxLjEwNy4xNjAuMjA2IiwibmFtZSI6IlNoaWJhbmkgTWVkaGVrYXIiLCJvaWQiOiI1YWJiYzQ0NS1hZDBmLTQ1MTYtODEzYS02MTA2OTkyNTc1OTIiLCJvbnByZW1fc2lkIjoiUy0xLTUtMjEtMjEyNzUyMTE4NC0xNjA0MDEyOTIwLTE4ODc5Mjc1MjctMTU0MTY0NzIiLCJwdWlkIjoiMTAwMzAwMDA4QkRFRUZBQSIsInJoIjoiMC5BUm9BdjRqNWN2R0dyMEdScXkxODBCSGJSNE5BUzhTd084Rkp0SDJYVGxQTDN6d2FBS2MuIiwic2NwIjoidXNlcl9pbXBlcnNvbmF0aW9uIiwic3ViIjoiNXBYNWo1eUZfOUc0ekdFb0Z5cU1zbVA1NjA1bUY4YnZwTk9GZlRFTmkycyIsInRpZCI6IjcyZjk4OGJmLTg2ZjEtNDFhZi05MWFiLTJkN2NkMDExZGI0NyIsInVuaXF1ZV9uYW1lIjoic2hpbWVkaEBtaWNyb3NvZnQuY29tIiwidXBuIjoic2hpbWVkaEBtaWNyb3NvZnQuY29tIiwidXRpIjoiMkcwNEI5b3A4VTJhTkxNZXlKVUZBQSIsInZlciI6IjEuMCIsInhtc190Y2R0IjoxMjg5MjQxNTQ3fQ.drTJgAkYEegk3Mp-C5yy4tBk22EDX-VeHLyH_4CIDmm1YaCQAWaBhGi6qHaJCMXepyiogFIsalls7fn0IXnrezuEeWdRtp2n-KkDRut7opWu0MCzVgRGYfIQDUwpMa2pXJ7HW3RWm7ZoV27zHPY_HWqweh_p_JgCt5Qd7NcL_-ObwmRxIrwO2RH0MCGOiRKAiYYzYVHWm1Mzyl7uXExCDkty0NyDXpM59yaE67zpHnZ07PDwRvIk6dRqVy0peXYe0WAPfZdGpuQv60ksSh1-_yXiVU61wEfm9taVdJgE931jzZgyH-JLk6OtgKtfxpJVsDD27uOIVryczq6xLuQszw"} });
        request.streamResponseBody = true;
        const client: ServiceClient = await createGenericClient();
        const response: HttpOperationResponse = await client.sendRequest(request);
        const stream: NodeJS.ReadableStream = nonNullProp(response, 'readableStreamBody');
        await new Promise(async (resolve, reject): Promise<void> => {
            stream.pipe(fse.createWriteStream(filePath).on('finish', resolve).on('error', reject));
        });
    }
}
