/**
 * Command: Select AWS profile or enter credentials manually
 * Requirements: 2.2, 2.3, 2.4, 2.5
 */

import * as vscode from 'vscode';
import { ICredentialProvider } from '../services/credential-provider';
import { IS3ClientFactory } from '../aws/client-factory';
import { S3TreeProvider } from '../views/s3-tree-provider';

const MANUAL_ENTRY_LABEL = '$(add) Enter credentials manually';

export async function selectProfile(
    credentialProvider: ICredentialProvider,
    clientFactory: IS3ClientFactory,
    treeProvider: S3TreeProvider,
    statusBarItem?: vscode.StatusBarItem,
): Promise<void> {
    const profiles = await credentialProvider.listProfiles();

    const items: vscode.QuickPickItem[] = [
        ...profiles.map((p) => ({ label: p, description: 'AWS profile' })),
        { label: MANUAL_ENTRY_LABEL, description: 'Enter Access Key ID and Secret Access Key' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an AWS profile or enter credentials manually',
    });

    if (!selected) {
        return;
    }

    if (selected.label === MANUAL_ENTRY_LABEL) {
        await enterCredentialsManually(credentialProvider, clientFactory, treeProvider, statusBarItem);
        return;
    }

    // Profile selected
    const profileName = selected.label;
    try {
        const credentials = await credentialProvider.getCredentials(profileName);
        await credentialProvider.storeCredentials({ ...credentials, profile: profileName });
        clientFactory.updateCredentials(credentials);
        treeProvider.refresh();
        if (statusBarItem) {
            statusBarItem.text = `$(key) AWS: ${profileName}`;
            statusBarItem.show();
        }
        vscode.window.showInformationMessage(`AWS profile "${profileName}" selected.`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to load profile "${profileName}": ${msg}`);
    }
}

async function enterCredentialsManually(
    credentialProvider: ICredentialProvider,
    clientFactory: IS3ClientFactory,
    treeProvider: S3TreeProvider,
    statusBarItem?: vscode.StatusBarItem,
): Promise<void> {
    const accessKeyId = await vscode.window.showInputBox({
        prompt: 'Enter AWS Access Key ID',
        placeHolder: 'AKIAIOSFODNN7EXAMPLE',
        ignoreFocusOut: true,
    });
    if (!accessKeyId) {
        return;
    }

    const secretAccessKey = await vscode.window.showInputBox({
        prompt: 'Enter AWS Secret Access Key',
        placeHolder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        password: true,
        ignoreFocusOut: true,
    });
    if (!secretAccessKey) {
        return;
    }

    const credentials = { accessKeyId, secretAccessKey };
    await credentialProvider.storeCredentials(credentials);
    clientFactory.updateCredentials(credentials);
    treeProvider.refresh();

    if (statusBarItem) {
        statusBarItem.text = `$(key) AWS: manual`;
        statusBarItem.show();
    }

    vscode.window.showInformationMessage('AWS credentials saved successfully.');
}
