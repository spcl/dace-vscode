//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/**
 * @type {import('webpack').Configuration}
 */
const extensionConfig = {
    target: 'node',
    entry:  './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    devtool: 'source-map',
    externals: {
        vscode: 'commonjs vscode',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
        ],
    },
};

const webSrcDir = './src/webclients/components';

/**
 * @type {import('webpack').Configuration}
 */
const webclientConfig = {
    target: 'web',
    entry: {
        analysis: webSrcDir + '/analysis/analysis.ts',
        breakpoints: webSrcDir + '/breakpoints/breakpoints.ts',
        history: webSrcDir + '/history/transformation_history.ts',
        outline: webSrcDir + '/outline/outline.ts',
        sdfv: webSrcDir + '/sdfv/vscode_sdfv.ts',
        transformations: webSrcDir + '/transformations/transformations.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist', 'web'),
        filename: '[name].js',
    },
    devtool: 'source-map',
    externals: {
        vscode: 'commonjs vscode',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.m?[jt]sx?$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                ],
            },
            {
                test: /\.ttf$/,
                use: 'file-loader',
            },
            {
                test: /\.(scss)$/,
                use: [
                    {
                        loader: 'style-loader',
                    },
                    {
                        loader: 'css-loader',
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: function () {
                                    return [
                                        require('autoprefixer'),
                                    ];
                                },
                            },
                        },
                    },
                    {
                        loader: 'sass-loader',
                    },
                ],
            },
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
        }),
    ],
};

module.exports = [
    extensionConfig,
    webclientConfig,
];
