var binary = require('binary');
var stream = require('stream');
var util = require('util');
var zlib = require('zlib');
var MatcherStream = require('./matcher-stream');
var Entry = require('./entry');

var states = {
    START: 0,
    LOCAL_FILE_HEADER: 1,
    LOCAL_FILE_HEADER_SUFFIX: 2,
    FILE_DATA: 3,
    FILE_DATA_END: 4,
    DATA_DESCRIPTOR: 5,
    CENTRAL_DIRECTORY_FILE_HEADER: 6,
    CENTRAL_DIRECTORY_FILE_HEADER_SUFFIX: 7,
    CENTRAL_DIRECTORY_END: 8,
    CENTRAL_DIRECTORY_END_COMMENT: 9,
	SIG_ZIP64_EOCD: 10,

    ERROR: 99
};

var FOUR_GIGS = 4294967296;

var LOCAL_FILE_HEADER_SIG = 0x04034b50; 
var DATA_DESCRIPTOR_SIG = 0x08074b50;
var CENTRAL_DIRECTORY_SIG = 0x02014b50;
var CENTRAL_DIRECTORY_END_SIG = 0x06054b50;
var SIG_ZIP64_EOCD = 0x06064B50;
var SIG_ZIP64_EOCD_LOC = 0x07064B50;

function UnzipStream() {
    if (!(this instanceof UnzipStream)) {
        return new UnzipStream();
    }

    stream.Transform.call(this);

    this.data = new Buffer('');
    this.state = states.START;
    this.parsedEntity = null;
    this.outStreamInfo = {};
}

util.inherits(UnzipStream, stream.Transform);

UnzipStream.prototype.processDataChunk = function (chunk) {
    var requiredLength;

    switch (this.state) {
        case states.START:
            requiredLength = 4;
            break;
        case states.LOCAL_FILE_HEADER:
            requiredLength = 26;
            break;
        case states.LOCAL_FILE_HEADER_SUFFIX:
            requiredLength = this.parsedEntity.fileNameLength + this.parsedEntity.extraFieldLength;
            break;
        case states.DATA_DESCRIPTOR:
            requiredLength = 12;
            break;
        case states.CENTRAL_DIRECTORY_FILE_HEADER:
            requiredLength = 42;
            break;
        case states.CENTRAL_DIRECTORY_FILE_HEADER_SUFFIX:
            requiredLength = this.parsedEntity.fileNameLength + this.parsedEntity.extraFieldLength + this.parsedEntity.fileCommentLength;
            break;
        case states.CENTRAL_DIRECTORY_END:
            requiredLength = 18;
            break;
        case states.FILE_DATA:
            return 0;
        case states.FILE_DATA_END:
            return 0;
        default:
            return chunk.length;
    }

    var chunkLength = chunk.length;
    if (chunkLength < requiredLength) {
        return 0;
    }

    switch (this.state) {
        case states.START:
            while (chunk[0] === 0x00 && chunk.length) {
                this.data = this.data.slice(1, this.data.length);
                chunk = this.data;
                chunkLength = chunk.length;
                if ( chunkLength < requiredLength ) {
                    return 0;
                }
            }
            switch (chunk.readUInt32LE(0)) {
                case LOCAL_FILE_HEADER_SIG:
                    this.state = states.LOCAL_FILE_HEADER;
                    break;
                case CENTRAL_DIRECTORY_SIG:
                    this.state = states.CENTRAL_DIRECTORY_FILE_HEADER;
                    break;
                case CENTRAL_DIRECTORY_END_SIG:
                    this.state = states.CENTRAL_DIRECTORY_END;
                    break;
                case SIG_ZIP64_EOCD:
                    this.state = states.SIG_ZIP64_EOCD;
                    break;
                case 65600:
                    this.state = 11;
                    break;
                default:
                    this.state = states.ERROR;
                    this.emit("error", new Error("Invalid signature in zip file"));
                    return chunk.length;
            }
            return requiredLength;

        case states.LOCAL_FILE_HEADER:
            this.parsedEntity = this._readFile(chunk);
            this.state = states.LOCAL_FILE_HEADER_SUFFIX;

            return requiredLength;

        case states.LOCAL_FILE_HEADER_SUFFIX:
            var entry = new Entry();
            entry.path = chunk.slice(0, this.parsedEntity.fileNameLength).toString();
            this.parsedEntity.extra = this._readExtraFields(chunk.slice(this.parsedEntity.fileNameLength, this.parsedEntity.fileNameLength + this.parsedEntity.extraFieldLength));
            this._prepareOutStream(this.parsedEntity, entry);

            this.emit("entry", entry);

            this.state = states.FILE_DATA;

            return requiredLength;

        case states.CENTRAL_DIRECTORY_FILE_HEADER:
            this.parsedEntity = this._readCentralDirectoryEntry(chunk);
            this.state = states.CENTRAL_DIRECTORY_FILE_HEADER_SUFFIX;

            return requiredLength;

        case states.CENTRAL_DIRECTORY_FILE_HEADER_SUFFIX:
            // got file name in chunk[0..]
            this.state = states.START;

            return requiredLength;

        case states.CENTRAL_DIRECTORY_END:
            this.state = states.CENTRAL_DIRECTORY_END_COMMENT;

            return requiredLength;

        case states.CENTRAL_DIRECTORY_END_COMMENT:
            return chunk.length;

        case states.ERROR:
            return chunk.length; // discard

        default:
            console.log("didn't handle state #", this.state, "discarding");
            return chunk.length;
    }
}

UnzipStream.prototype._prepareOutStream = function (vars, entry) {
    var self = this;

    var isDirectory = vars.compressedSize === 0 && /[\/\\]$/.test(entry.path);
    entry.type = isDirectory ? 'Directory' : 'File';
    entry.isDirectory = isDirectory;

    var fileSizeKnown = !(vars.flags & 0x08);
    if (fileSizeKnown) {
        entry.size = vars.uncompressedSize;
    }

    var isVersionSupported = vars.versionsNeededToExtract <= 21;

    this.outStreamInfo = {
        stream: null,
        limit: fileSizeKnown ? vars.compressedSize : -1,
        written: 0
    };

    if (!fileSizeKnown) {
        var pattern = new Buffer(4);
        pattern.writeUInt32LE(DATA_DESCRIPTOR_SIG, 0);
        var searchPattern = {
            pattern: pattern,
            requiredExtraSize: 12
        }

        var matcherStream = new MatcherStream(searchPattern, function (matchedChunk, sizeSoFar) {
            var vars = self._readDataDescriptor(matchedChunk);

            var compressedSizeMatches = vars.compressedSize === sizeSoFar;
            // let's also deal with archives with 4GiB+ files without zip64
            if (!compressedSizeMatches && sizeSoFar >= FOUR_GIGS) {
                var overflown = sizeSoFar - FOUR_GIGS;
                while (overflown >= 0) {
                    compressedSizeMatches = vars.compressedSize === overflown;
                    if (compressedSizeMatches) break;
                    overflown -= FOUR_GIGS;
                }
            }
            if (!compressedSizeMatches) { return; }

            var dataDescriptorSize = vars.zip64 ? 24 : 16;

            self.state = states.FILE_DATA_END;
            if (self.data.length > 0) {
                self.data = Buffer.concat([matchedChunk.slice(dataDescriptorSize), self.data]);
            } else {
                self.data = matchedChunk.slice(dataDescriptorSize);
            }

            return true;
        });
        this.outStreamInfo.stream = matcherStream;
    } else {
        this.outStreamInfo.stream = new stream.PassThrough();
    }

    var isEncrypted = (vars.flags & 0x01) || (vars.flags & 0x40);
    if (isEncrypted || !isVersionSupported) {
        var message = isEncrypted ? "Encrypted files are not supported!"
            : ("Zip version " + Math.floor(vars.versionsNeededToExtract / 10) + "." + vars.versionsNeededToExtract % 10 + " is not supported");

        entry.skip = true;
        setImmediate(function() {
            entry.emit("error", new Error(message));
        });

        // try to skip over this entry
        this.outStreamInfo.stream.pipe(new Entry().autodrain());
        return;
    }

    var isCompressed = vars.compressionMethod > 0;
    if (isCompressed) {
        var inflater = zlib.createInflateRaw();
        inflater.on('error', function (err) {
            self.state = states.ERROR;
            self.emit('error', err);
        });
        this.outStreamInfo.stream.pipe(inflater).pipe(entry);
    } else {
        this.outStreamInfo.stream.pipe(entry);
    }

    if (this._drainAllEntries) {
        entry.autodrain();
    }
}

UnzipStream.prototype._readFile = function (data) {
    var vars = binary.parse(data)
        .word16lu('versionsNeededToExtract')
        .word16lu('flags')
        .word16lu('compressionMethod')
        .word16lu('lastModifiedTime')
        .word16lu('lastModifiedDate')
        .word32lu('crc32')
        .word32lu('compressedSize')
        .word32lu('uncompressedSize')
        .word16lu('fileNameLength')
        .word16lu('extraFieldLength')
        .vars;

    return vars;
}

UnzipStream.prototype._readExtraFields = function (data) {
    var extra = {};
    var index = 0;
    while (index < data.length) {
        var vars = binary.parse(data)
            .skip(index)
            .word16lu('extraId')
            .word16lu('extraSize')
            .vars;

        index += 4;

        switch (vars.extraId) {
            case 0x5455:
                var timestampFields = data.readUInt8(index);
                var offset = 1;
                if (timestampFields & 1) {
                    extra.mtime = new Date(data.readUInt32LE(index + offset) * 1000);
                    offset += 4;
                }
                if (timestampFields & 2) {
                    extra.atime = new Date(data.readUInt32LE(index + offset) * 1000);
                    offset += 4;
                }
                if (timestampFields & 4) {
                    extra.ctime = new Date(data.readUInt32LE(index + offset) * 1000);
                }
                break;
            case 0x7875:
            /* TODO: handle
            var uidSize = data.readUInt8(index + 1);
            var gidSize = data.readUInt8(index + 1 + uidSize);
            */
        }

        index += vars.extraSize;
    }

    return extra;
}

UnzipStream.prototype._readDataDescriptor = function (data) {
    // Try reading zip64 data descriptor (8 byte sizes)
    // https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT 4.3.9.2
    var vars = binary.parse(data)
        .word32lu('dataDescriptorSignature')
        .word32lu('crc32')
        .word64lu('compressedSize')
        .word64lu('uncompressedSize')
        .word32lu('nextHeader')
        .vars;
    
    if (vars.nextHeader !== LOCAL_FILE_HEADER_SIG && vars.nextHeader !== CENTRAL_DIRECTORY_SIG) {
        // Not a zip64 data descriptor, use 4 byte sizes
        
        vars = binary.parse(data)
        .word32lu('dataDescriptorSignature')
        .word32lu('crc32')
        .word32lu('compressedSize')
        .word32lu('uncompressedSize')
        .vars;
        
        vars['zip64'] = false;
    } else {
        delete vars['nextHeader'];
        vars['zip64'] = true;
    }

    return vars;
}

UnzipStream.prototype._readCentralDirectoryEntry = function (data) {
    var vars = binary.parse(data)
        .word16lu('versionMadeBy')
        .word16lu('versionsNeededToExtract')
        .word16lu('flags')
        .word16lu('compressionMethod')
        .word16lu('lastModifiedTime')
        .word16lu('lastModifiedDate')
        .word32lu('crc32')
        .word32lu('compressedSize')
        .word32lu('uncompressedSize')
        .word16lu('fileNameLength')
        .word16lu('extraFieldLength')
        .word16lu('fileCommentLength')
        .word16lu('diskNumber')
        .word16lu('internalFileAttributes')
        .word32lu('externalFileAttributes')
        .word32lu('offsetToLocalFileHeader')
        .vars;

    return vars;
}

UnzipStream.prototype._readEndOfCentralDirectory = function (data) {
    var vars = binary.parse(data)
        .word16lu('diskNumber')
        .word16lu('diskStart')
        .word16lu('numberOfRecordsOnDisk')
        .word16lu('numberOfRecords')
        .word32lu('sizeOfCentralDirectory')
        .word32lu('offsetToStartOfCentralDirectory')
        .word16lu('commentLength')
        .vars;

    return vars;
}

UnzipStream.prototype._parseOrOutput = function (encoding, cb) {
    var consume;
    while ((consume = this.processDataChunk(this.data)) > 0) {
        this.data = this.data.slice(consume);
        if (this.data.length === 0) break;
    }

    if (this.state === states.FILE_DATA) {
        if (this.outStreamInfo.limit >= 0) {
            var remaining = this.outStreamInfo.limit - this.outStreamInfo.written;
            var packet;
            if (remaining < this.data.length) {
                packet = this.data.slice(0, remaining);
                this.data = this.data.slice(remaining);
            } else {
                packet = this.data;
                this.data = new Buffer('');
            }

            this.outStreamInfo.written += packet.length;
            if (this.outStreamInfo.limit === this.outStreamInfo.written) {
                this.state = states.START;

                this.outStreamInfo.stream.end(packet, encoding, cb);
            } else {
                this.outStreamInfo.stream.write(packet, encoding, cb);
            }
        } else {
            var packet = this.data;
            this.data = new Buffer('');

            this.outStreamInfo.written += packet.length;
            var outputStream = this.outStreamInfo.stream;
            var self = this;
            outputStream.write(packet, encoding, function() {
                if (self.state === states.FILE_DATA_END) {
                    self.state = states.START;
                    return outputStream.end(cb);
                }
                cb();
            });
        }
        // we've written to the output stream, letting that write deal with the callback
        return;
    }

    cb();
}

UnzipStream.prototype.drainAll = function () {
    this._drainAllEntries = true;
}

UnzipStream.prototype._transform = function (chunk, encoding, cb) {
    var self = this;
    if (self.data.length > 0) {
        self.data = Buffer.concat([self.data, chunk]);
    } else {
        self.data = chunk;
    }

    var startDataLength = self.data.length;
    var done = function () {
        if (self.data.length > 0 && self.data.length < startDataLength) {
            startDataLength = self.data.length;
            self._parseOrOutput(encoding, done);
            return;
        }
        cb();
    };
    self._parseOrOutput(encoding, done);
}

UnzipStream.prototype._flush = function (cb) {
    var self = this;
    if (self.data.length > 0) {
        self._parseOrOutput('buffer', function () {
            if (self.data.length > 0) return setImmediate(function () { self._flush(cb); });
            cb();
        });

        return;
    }

    if (self.state === states.FILE_DATA) {
        // uh oh, something went wrong
        return cb(new Error("Stream finished in an invalid state, uncompression failed"));
    }

    setImmediate(cb);
}

module.exports = UnzipStream;
