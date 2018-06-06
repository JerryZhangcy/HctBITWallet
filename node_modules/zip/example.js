var zip = require('zip');

var archive = new zip('test.zip');

archive.file('API.js', 'API.js');

archive.end(function() {
	console.log('end');
});