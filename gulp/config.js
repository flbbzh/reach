/* eslint complexity:0 */

import webpack from 'webpack';
import {readFileSync} from 'fs';

const
	distFolder = './dist',
	libName = 'Reach',
	devOutputName = 'reach-debug.js',
	releaseOutputName = 'reach.js',
	license = readFileSync(`${__dirname}/../LICENSE`, 'utf8');

/**
 * Returns default webpack configuration.
 * Initialize Babel to parse js files and resolve node dependencies
 * @returns {Object}
 */
function getDefaultWebpackConfig() {
	return {
		module: {
			loaders: [
				{
					test:/(src)|(test)\/.*\.js/,
					loader: 'babel'
				}
			]
		},
		resolve: {
			alias: {
				'adapterjs':  '../node_modules/adapterjs/publish/adapter.min.js'
			}
		},
		output: {
			libraryTarget: 'umd',
			library: libName
		},
		plugins: [
			new webpack.BannerPlugin(license)
		]
	};
}

export default {
	name: libName,
	distFolder,
	devOutputName,
	releaseOutputName,

	/**
	 * Get checkstyle directory
	 * @returns {string}
	 */
	get checkstyleDir(){
		return `${distFolder}/checkstyle`;
	},

	/**
	 * Return webpack configuration object
	 * @param {Object} options - debug or release build ? output file ? with coverage instrumentation code ?
	 * @returns {{module: {loaders: {test: RegExp, loader: string, query: {optional: string[]}}[]}, resolve: {alias: {adapterjs: string}}, output: {libraryTarget: string, library: string}}}
	 */
	webpack: (options = {
		release:false,
		debug: false,
		coverage: false,
		output: false }) => {

		const config = getDefaultWebpackConfig();

		if (options.output) {
			Object.assign(config, {
				entry: './src/index.js'
			});
			config.output.path = './dist';
			config.output.filename = options.release ? releaseOutputName : devOutputName;
		}

		if (options.release) {
			config.plugins = config.plugins.concat([
				new webpack.optimize.DedupePlugin(),
				new webpack.optimize.OccurenceOrderPlugin(),
				new webpack.optimize.AggressiveMergingPlugin(),
				new webpack.optimize.UglifyJsPlugin({minimize: true})
			]);
		}

		if (options.debug) {
			config.devtool = 'inline-source-map';
			config.watch = true;
		}

		if (options.coverage) {
			config.module.loaders.push({
				test: /\.js$/,
				loaders: ['isparta'],
				include: /src.*/,
				exclude: /node_modules|\.test.js$|\.mock\.js$/
			});
		}

		return config;
	}
};

