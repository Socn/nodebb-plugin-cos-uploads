var Package = require("./package.json");

var COS = require('cos-nodejs-sdk-v5');

var mime = require("mime"),
	uuid = require("uuid").v4,
	fs = require("fs"),
	request = require("request"),
	path = require("path"),
	winston = module.parent.require("winston"),
	nconf = module.parent.require('nconf'),
	gm = require("gm"),
	im = gm.subClass({imageMagick: true}),
	meta = require.main.require("./src/meta"),
	db = require.main.require("./src/database");

var plugin = {}

"use strict";

var COSConn = null;
var settings = {
	"SecretId": false,
	"SecretKey": false,
	"region": process.env.COS_DEFAULT_REGION || undefined,
	"bucket": process.env.COS_UPLOADS_BUCKET || undefined,
	"host": process.env.COS_UPLOADS_HOST || "myqcloud.com",
	"path": process.env.COS_UPLOADS_PATH || undefined
};

var SecretIdFromDb = false;
var SecretKeyFromDb = false;

function fetchSettings(callback) {
	db.getObjectFields(Package.name, Object.keys(settings), function (err, newSettings) {
		if (err) {
			winston.error(err.message);
			if (typeof callback === "function") {
				callback(err);
			}
			return;
		}

		SecretIdFromDb = false;
		SecretKeyFromDb = false;

		if (newSettings.SecretId) {
			settings.SecretId = newSettings.SecretId;
			SecretIdFromDb = true;
		} else {
			settings.SecretId = false;
		}

		if (newSettings.SecretKey) {
			settings.SecretKey = newSettings.SecretKey;
			SecretKeyFromDb = false;
		} else {
			settings.SecretKey = false;
		}

		if (!newSettings.bucket) {
			settings.bucket = process.env.COS_UPLOADS_BUCKET || "";
		} else {
			settings.bucket = newSettings.bucket;
		}

		if (!newSettings.host) {
			settings.host = process.env.COS_UPLOADS_HOST || "";
		} else {
			settings.host = newSettings.host;
		}

		if (!newSettings.path) {
			settings.path = process.env.COS_UPLOADS_PATH || "";
		} else {
			settings.path = newSettings.path;
		}

		if (!newSettings.region) {
			settings.region = process.env.COS_DEFAULT_REGION || "";
		} else {
			settings.region = newSettings.region;
		}

		// if (settings.accessKeyId && settings.secretAccessKey) {
		// 	AWS.config.update({
		// 		accessKeyId: settings.accessKeyId,
		// 		secretAccessKey: settings.secretAccessKey
		// 	});
		// }

		// if (settings.region) {
		// 	AWS.config.update({
		// 		region: settings.region
		// 	});
		// }

		if (typeof callback === "function") {
			callback();
		}
	});
}

function connCos() {
	if (!COSConn) {
		COSConn = new COS({
            SecretId: settings.SecretId,
            SecretKey: settings.SecretKey
        });
	}

	return COSConn;
}

function makeError(err) {
	if (err instanceof Error) {
		err.message = Package.name + " :: " + err.message;
	} else {
		err = new Error(Package.name + " :: " + err);
	}
	console.log(err);
	winston.error(err.message);
	return err;
}

plugin.activate = function (data) {
	if (data.id === 'nodebb-plugin-cos-uploads') {
		fetchSettings();
	}

};

plugin.deactivate = function (data) {
	if (data.id === 'nodebb-plugin-cos-uploads') {
		COSConn = null;
	}
};

plugin.load = function (params, callback) {
	fetchSettings(function (err) {
		if (err) {
			return winston.error(err.message);
		}
		var adminRoute = "/admin/plugins/cos-uploads";

		params.router.get(adminRoute, params.middleware.applyCSRF, params.middleware.admin.buildHeader, renderAdmin);
		params.router.get("/api" + adminRoute, params.middleware.applyCSRF, renderAdmin);

		params.router.post("/api" + adminRoute + "/cossettings", cossettings);
		params.router.post("/api" + adminRoute + "/credentials", credentials);

		callback();
	});
};

function renderAdmin(req, res) {
	// Regenerate csrf token
	var token = req.csrfToken();

	var forumPath = nconf.get('url');
	if(forumPath.split("").reverse()[0] != "/" ){
		forumPath = forumPath + "/";
	}
	var data = {
		bucket: settings.bucket,
		host: settings.host,
		path: settings.path,
		forumPath: forumPath,
		region: settings.region,
		SecretId: (SecretIdFromDb && settings.SecretId) || "",
		SecretKey: (SecretKeyFromDb && settings.SecretKey) || "",
		csrf: token
	};

	res.render("admin/plugins/cos-uploads", data);
}

function cossettings(req, res, next) {
	var data = req.body;
	var newSettings = {
		bucket: data.bucket || "",
		host: data.host || "",
		path: data.path || "",
		region: data.region || ""
	};

	saveSettings(newSettings, res, next);
}

function credentials(req, res, next) {
	var data = req.body;
	var newSettings = {
		SecretId: data.SecretId || "",
		SecretKey: data.SecretKey || ""
	};

	saveSettings(newSettings, res, next);
}

function saveSettings(settings, res, next) {
	db.setObject(Package.name, settings, function (err) {
		if (err) {
			return next(makeError(err));
		}

		fetchSettings();
		res.json("Saved!");
	});
}

plugin.uploadImage = function (data, callback) {
	var image = data.image;

	if (!image) {
		winston.error("invalid image" );
		return callback(new Error("invalid image"));
	}

	//check filesize vs. settings
	if (image.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize );
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	var type = image.url ? "url" : "file";
	var allowedMimeTypes = ['image/png', 'image/jpeg', 'image/gif'];

	if (type === "file") {
		if (!image.path) {
			return callback(new Error("invalid image path"));
		}

		if (allowedMimeTypes.indexOf(mime.lookup(image.path)) === -1) {
			return callback(new Error("invalid mime type"));
		}

		fs.readFile(image.path, function (err, buffer) {
			uploadToCOS(image.name, err, buffer, callback);
		});
	}
	else {
		if (allowedMimeTypes.indexOf(mime.lookup(image.url)) === -1) {
			return callback(new Error("invalid mime type"));
		}
		var filename = image.url.split("/").pop();

		var imageDimension = parseInt(meta.config.profileImageDimension, 10) || 128;

		// Resize image.
		im(request(image.url), filename)
			.resize(imageDimension + "^", imageDimension + "^")
			.stream(function (err, stdout, stderr) {
				if (err) {
					return callback(makeError(err));
				}

				// This is sort of a hack - We"re going to stream the gm output to a buffer and then upload.
				// See https://github.com/aws/aws-sdk-js/issues/94
				var buf = new Buffer(0);
				stdout.on("data", function (d) {
					buf = Buffer.concat([buf, d]);
				});
				stdout.on("end", function () {
					uploadToCOS(filename, null, buf, callback);
				});
			});
	}
};

plugin.uploadFile = function (data, callback) {
	var file = data.file;

	if (!file) {
		return callback(new Error("invalid file"));
	}

	if (!file.path) {
		return callback(new Error("invalid file path"));
	}

	//check filesize vs. settings
	if (file.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize );
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	fs.readFile(file.path, function (err, buffer) {
		uploadToCOS(file.name, err, buffer, callback);
	});
};

function uploadToCOS(filename, err, buffer, callback) {
	if (err) {
		return callback(makeError(err));
	}

	var cosPath;
	if (settings.path && 0 < settings.path.length) {
		cosPath = settings.path;

		if (!cosPath.match(/\/$/)) {
			// Add trailing slash
			cosPath = cosPath + "/";
		}
	}
	else {
		cosPath = "/";
	}

	var cosKeyPath = cosPath.replace(/^\//, ""); // S3 Key Path should not start with slash.

	// var params = {
	// 	Bucket: settings.bucket,
    //     Region: settings.region,
    //     Host: settings.host,
	// 	ACL: "public-read",
	// 	Key: cosKeyPath + uuid() + path.extname(filename),
	// 	Body: buffer,
	// 	ContentLength: buffer.length,
	// 	ContentType: mime.lookup(filename)
	// };

    connCos().putObject({
        Bucket: settings.bucket,
        Region: settings.region,
        Key: cosKeyPath + uuid() + path.extname(filename),
        StorageClass: 'STANDARD',
        Body: buffer,
        onProgress: function(progressData) {
            console.log(JSON.stringify(progressData));
        }
     }, function(err, data) {
        if(err == null){
            callback(null,{
                name:filename,
                url:data.Location
            });
        }
        
    });


	// S3().putObject(params, function (err) {
	// 	if (err) {
	// 		return callback(makeError(err));
	// 	}

	// 	// amazon has https enabled, we use it by default
	// 	var host = "https://" + params.Bucket +".cos."+params.Region+params.Host;
	// 	// if (settings.host && 0 < settings.host.length) {
	// 	// 	host = settings.host;
	// 	// 	// host must start with http or https
	// 	// 	if (!host.startsWith("http")) {
	// 	// 		host = "http://" + host;
	// 	// 	}
	// 	// }

	// 	callback(null, {
	// 		name: filename,
	// 		url: host + "/" + params.Key
	// 	});
	// });
}

var admin = plugin.admin = {};

admin.menu = function (custom_header, callback) {
	custom_header.plugins.push({
		"route": "/plugins/cos-uploads",
		"icon": "fa-envelope-o",
		"name": "COS Uploads"
	});

	callback(null, custom_header);
};

module.exports = plugin;
