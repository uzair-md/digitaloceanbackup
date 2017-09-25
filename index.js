/**
 * Author: haxpor
 * Link: https://github.com/haxpor/digittaloceanbackup
 * It can be used as it is, otherwise see README.md on github.
 */

'use strict';

require('./promise-retry.js');
const mainCall = require('./promise-syncloop.js');
const readline = require('readline');
const ConfigFile = require('./ConfigFile.js');
const DGApi = require('./DGApi.js');

var configFile = new ConfigFile('./config.json');

// get access token as set in environment variable
const access_token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
if (access_token == null || access_token == '') {
	console.log('Error. Access token is not set yet, or invalid.\nSet it to via\n\t export DIGITALOCEAN_ACCESS_TOKEN=\'<your access token>\'');
	process.exit(-1);
}

// create DGApi
var dgApi = new DGApi(access_token);

try {
	// read config file
	// then get config content read into memory inside ConfigFile
	configFile.read();
} catch(e) {
	console.log(e);
	process.exit(-1);
}

// get config settings
const dropletIds = configFile.dropletIds;
const holdSnapshots = configFile.holdSnapshots;

// see promise-syncloop.js for this function signature detail
var workerFn = function(i, ...args) {
	return new Promise((resolve, reject) => {
		// get id from droplet
		const dropletId = dropletIds[i];

		var snapshots = null;
		var path = 1;

		// now we got dropletIds in memory of our configFile
		console.log('Getting list of snapshots for dropletId (id:' + dropletId + ')');
		Promise.retry(3, dgApi.getListOfSnapshotsForDropletId.bind(dgApi), 3000, dropletId)
			.then((result) => {
				var resultObj = JSON.parse(result);
				snapshots = resultObj.snapshots;
				console.log(snapshots);

				// check if we need to delete the oldest snapshot
				// to make room for a new one
				if (snapshots && snapshots.length >= holdSnapshots) {
					var oldestSnapshotId = snapshots[snapshots.length-1].id;
					// delete oldest snapshot
					console.log('Deleting oldest snapshot (id:' + oldestSnapshotId + ')');
					Promise.retry(3, dgApi.deleteSnapshotById.bind(dgApi), 3000, oldestSnapshotId)
						.then((_result) => {
							console.log('Deleted oldest snapshot');
						})
						.then(() => {
							// snapshot a droplet
							console.log('Snapshotting for droplet (id:' + dropletId + ')');
							path = 2;
							return Promise.retry(3, dgApi.snapshotDroplet.bind(dgApi), 3000, dropletId);
						})
						.catch((_err) => {
							console.log(_err.message);
							reject(); // reject this task
						});
				}
				else {
					// snapshot a droplet
					console.log('Snapshotting for droplet (id:' + dropletId + ')');
					path = 2;
					return Promise.retry(3, dgApi.snapshotDroplet.bind(dgApi), 3000, dropletId);
				}
			})
			.then((result) => {
				if (path == 2) {
					console.log('Snapshoted a droplet successfully');
					resolve();	// resolve this task
				}
			})
			.catch((err) => {
				console.log('Error operation for droplet (id: ' + dropletId + ') with reason ' + err.message);
				reject();	// reject this task
			});
	});
}

if (dropletIds) {
	// wait for each promise-task to finish before executing next one
	mainCall(dropletIds.length, workerFn)
		.then(() => {
			console.log('all done!');
		})
		.catch((err) => {
			console.log(err);
		});
}