// Copyright 2020-2021 ETH Zurich and the DaCe-VSCode authors.
// All rights reserved.

import * as vscode from 'vscode';
import { DaCeVSCode } from '../extension';

export class CorrectnessReport {

    public uri: vscode.Uri;
    public date: string;

    public constructor(public sdfgName: string, path: string) {
        this.uri = vscode.Uri.file(path);
        this.date = new Date().toString();
    }

}

export class CorrectnessReportHandler extends vscode.Disposable {

    private static readonly INSTANCE: CorrectnessReportHandler =
        new CorrectnessReportHandler();

    private reports: CorrectnessReport[] = [];

    private constructor() {
        super(() => { this.saveReportsWorkspace(); });
    }

    public static getInstance(): CorrectnessReportHandler {
        return this.INSTANCE;
    }

    public loadStoredReports(): void {
        this.retrieveReportsWorkspace().then((reports) => {
            this.reports = reports;
        });
    }

    public async pickVerificationReport(): Promise<vscode.Uri[] | undefined> {
        this.reports = await this.removeDeletedOrRepeatedReports(this.reports);

        interface ReportItem extends vscode.QuickPickItem {
            report: CorrectnessReport | undefined;
        }

        const reportItems: ReportItem[] = [];
        reportItems.push({
            label: 'File picker',
            description: 'use the file picker to select a report',
            report: undefined,
        });

        for (let i = this.reports.length - 1; i >= 0; i--) {
            const report = this.reports[i];
            reportItems.push({
                label: report.sdfgName,
                description: report.date,
                report: report,
            });
        }

        const reportItem: ReportItem | undefined =
            await vscode.window.showQuickPick(reportItems, {
                placeHolder: 'Select the next run mode',
            });

        if (!reportItem)
            return undefined;

        if (!reportItem.report) {
            // Use the file picker.
            const reportOptions: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                title: 'Select Correctness Report',
                openLabel: 'Open',
                canSelectMany: false,
            };

            const wspaceFolders = vscode.workspace.workspaceFolders;
            if (wspaceFolders && wspaceFolders.length > 0)
                reportOptions.defaultUri = wspaceFolders[0].uri;

            return await vscode.window.showOpenDialog(reportOptions);
        } else {
            return [reportItem.report.uri];
        }
    }

    public saveVerificationReport(report: CorrectnessReport): void {
        this.reports.push(report);
        this.saveReportsWorkspace();
    }

    private async removeDeletedOrRepeatedReports(
        reports: CorrectnessReport[]
    ): Promise<CorrectnessReport[]> {
        // Remove all none existing reports.
        for (let i = reports.length - 1; i >= 0; i--) {
            try {
                await vscode.workspace.fs.stat(reports[i].uri);
            } catch (error) {
                reports.splice(i, 1);
                continue;
            }
            for (let j = reports.length - 1; j > i; j--) {
                if (reports[i].uri.fsPath === reports[j].uri.fsPath) {
                    reports.splice(i, 1);
                    continue;
                }
            }
        }
        return reports;
    }

    private saveReportsWorkspace(): void {
        DaCeVSCode.getExtensionContext()?.workspaceState.update(
            'sdfgReports', this.reports
        );
    }

    private async retrieveReportsWorkspace(): Promise<CorrectnessReport[]> {
        const context = DaCeVSCode.getExtensionContext();
        if (!context)
            return [];

        const reports = context.workspaceState.get(
            'sdfgReports', []
        ) as CorrectnessReport[];

        return this.removeDeletedOrRepeatedReports(reports);
    }

}
