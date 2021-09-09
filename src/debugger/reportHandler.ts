// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from "vscode";
import { DaCeVSCode } from "../extension";

export class Report {
    sdfgName: string;
    uri: vscode.Uri;
    date: string;

    constructor(sdfgName: string, path: string) {
        this.sdfgName = sdfgName;
        this.uri = vscode.Uri.file(path);
        this.date = new Date().toString();
    }
}

export class ReportHandler extends vscode.Disposable {

    private static INSTANCE: ReportHandler | undefined = undefined;

    reports: Report[] = [];

    constructor() {
        super(() => { this.saveReportsWorkspace(); });
        this.retrieveReportsWorkspace().then(reps => { this.reports = reps; });
    }

    public static getInstance(): ReportHandler | undefined {
        return this.INSTANCE;
    }

    public static activate() {
        ReportHandler.INSTANCE = new ReportHandler();
        return ReportHandler.INSTANCE;
    }

    public async pickVerificationReport(): Promise<vscode.Uri[] | undefined> {


        interface ReportItem extends vscode.QuickPickItem {
            report: Report | undefined;
        }

        let reportItems: ReportItem[] = [];
        reportItems.push({ label: 'File picker', description: 'use the file picker to select a report', report: undefined });
        for (let i = this.reports.length - 1; i >= 0; i--) {
            let r = this.reports[i];
            reportItems.push({ label: r.sdfgName, description: r.date, report: r });
        }

        const mode:
            | ReportItem
            | undefined = await vscode.window.showQuickPick(reportItems, {
                placeHolder: "Select the next run mode",
            });

        if (!mode) return undefined;
        if (!mode.report) {
            // Use the file picker
            let reportOptions: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                title: 'select Report',
                openLabel: 'select Report',
                canSelectMany: false
            };

            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length > 0)
                reportOptions.defaultUri = folders[0].uri;

            return await vscode.window.showOpenDialog(reportOptions);
        }
        else {
            return [mode.report.uri];
        }
    }

    public saveVerificationReport(report: Report) {
        this.reports.push(report);
        this.saveReportsWorkspace();
    }

    private saveReportsWorkspace() {
        DaCeVSCode.getExtensionContext()?.workspaceState
            .update('sdfgReports', this.reports);
    }

    private async retrieveReportsWorkspace() {
        const context = DaCeVSCode.getExtensionContext();
        if (!context) return [];
        let reports = context.workspaceState.get('sdfgReports', []) as Report[];

        // Remove all none existing reports
        for (let i = reports.length - 1; i >= 0; i--) {
            try {
                await vscode.workspace.fs.stat(reports[i].uri);
            } catch (error) {
                reports.splice(i, 1);
            }
        }
        return reports;
    }
}