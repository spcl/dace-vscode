//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin');

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
        dace: webSrcDir + '/dace/dace_panel.ts',
        sdfv: webSrcDir + '/sdfv/vscode_sdfv.ts',
        transformations: webSrcDir + '/transformations/transformations.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist', 'web'),
        filename: '[name].js',
    },
    devtool: 'eval-source-map',
    externals: {
        vscode: 'commonjs vscode',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        fallback: {
            assert: require.resolve('assert'),
            buffer: require.resolve('buffer'),
            stream: require.resolve('stream-browserify'),
            zlib: require.resolve('browserify-zlib'),
        },
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
            process: 'process/browser',
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'node_modules/@spcl/sdfv/external_lib',
                },
            ],
        }),
        new MonacoEditorWebpackPlugin(),
    ],
};

module.exports = [
    extensionConfig,
    webclientConfig,
];
