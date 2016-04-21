var crawl = require("npm-crawl");
var convert = require("npm-convert");
var utils = require("npm-utils");

function Runner(System){
	this.BaseSystem = System;
	this.deps = [];
	this.sources = {};
	this.fetchAllowed = {};
	this.fetchAll = false;
}

Runner.prototype.clone = function(){
	var runner = this;
	var System = this.BaseSystem;
	var loader = this.loader = System.clone();
	loader.set("@loader", loader.newModule({
		__useDefault: true,
		"default": loader
	}));

	var allow = {};
	utils.forEach([
		"package.json",
		"package.json!npm",
		"npm",
		"npm-convert",
		"npm-crawl",
		"npm-load",
		"npm-extension",
		"npm-utils",
		"semver",
		"@loader"
	], function(name){
		allow[name] = true;
	});

	this.rootPackage({
		name: "npm-test",
		main: "main.js",
		version: "1.0.0"
	});

	// Keep a copy of each package.json in this scope
	this.packagePaths = {};

	// Override loader.fetch and return packages that are part of this loader
	var fetch = loader.fetch;
	loader.fetch = function(load){
		var pkg = runner.packagePaths[load.address];
		if(pkg) {
			var json = JSON.stringify(pkg);
			return Promise.resolve(json);
		}
		if(load.name === "package.json!npm") {
			var source = JSON.stringify(runner.root);
			return Promise.resolve(source);

		}
		if(allow[load.name]) {
			var source = System.getModuleLoad(load.name).source;
			return Promise.resolve(source);
		}
		if(runner.sources[load.name]) {
			var source = runner.sources[load.name];
			return Promise.resolve(source);
		}
		if(this.fetchAll || this.fetchAllowed[load.name]) {
			return fetch.apply(this, arguments);
		}
		return Promise.reject();
	};

	loader.configMain = "package.json!npm";
	loader._configLoaded = false;

	var normalize = loader.normalize;
	loader.normalize = function(name){
		var loader = this, args = arguments;

		if(this._configLoaded) {
			return normalize.apply(this, arguments);
		}

		return normalize.apply(this, arguments)
			.then(function(name){
				if(allow[name]) {
					return name;
				}
				return loader.import("package.json!npm")
				.then(function(){
					loader._configLoaded = true;
					if(loader._installModules) {
						return loader._installModules();
					}
				})
				.then(function(){
					return normalize.apply(loader, args);
				});
			});
	};

	return this;
};

Runner.prototype.rootPackage = function(pkg){
	this.root = pkg;
	this._addVersion();
	return this;
};

/**
 * Add packages to the cloned loader. Packages can either be preloaded or not
 * by default they are. This function will add all of the appropriate config
 * to the loader for each scenario.
 */
Runner.prototype.withPackages = function(packages){
	// Do something to initialize these packages
	var deps = this.deps = packages.map(function(pkg){
		return (pkg instanceof Package) ? pkg : new Package(pkg);
	});

	var runner = this;
	deps.forEach(function(package){
		addPackage(package);
	});

	function addPackage(package, parentPackage, parentFileUrl){
		var pkg = package.pkg;

		var fileUrl = "./node_modules/" + pkg.name;

		if(parentPackage && runner.packagePaths[fileUrl]) {
			fileUrl = parentFileUrl + "/node_modules/" + pkg.name;
		}

		var pkgUrl = fileUrl + "/package.json";
		runner.packagePaths[pkgUrl] = pkg;

		package.forEachDeps(function(childPackage){
			addPackage(childPackage, package, fileUrl);
		});
	}

	return this;
};

Runner.prototype.withModule = function(moduleName, src){
	this.sources[moduleName] = src;
	return this;
};

Runner.prototype.withConfig = function(cfg){
	this.loader.config(cfg);
	return this;
};

Runner.prototype.npmVersion = function(version){
	this.algorithm = version >= 3 ? "flat": undefined;
	this._addVersion();
	return this;
};

Runner.prototype._addVersion = function(){
	var root = this.root;
	var algo = this.algorithm;
	if(algo) {
		var system = root.system = root.system || {};
		system.npmAlgorithm = algo;
	}
};

Runner.prototype.allowFetch = function(val){
	if(val === true) {
		this.fetchAll = true;
	} else {
		this.fetchAllowed[val] = true;
	}
	return this;
};

function Package(pkg){
	this.pkg = pkg;
	this._deps = [];
}

Package.toPackage = function(pkg){
	return (pkg instanceof Package) ? pkg : new Package(pkg)
};

Package.prototype.deps = function(deps){
	this._deps = this._deps.concat(deps.map(Package.toPackage));
	return this;
};

Package.prototype.forEachDeps = function(callback){
	var deps = this._deps;
	for(var i = 0, len = deps.length; i < len; i++) {
		callback(deps[i]);
	}
};

function toModule(fn){
	var source = fn.toString()
		.replace(/^function \(\).*{/, "");
	return source.substr(0, source.length - 1).trim();
}

module.exports = function(System){
	return {
		clone: function(){
			return new Runner(System).clone();
		},
		Package: Package,
		package: function(pkg){
			return new Package(pkg);
		},
    toModule: toModule
	};
};
