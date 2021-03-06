var jsc = require("./jsc");
require("./utils");

jsc.TextSpan = Object.define({
	initialize: function(begin, length) {
		this.begin = begin;
		this.length = length;
	},
	
	get end() {
		return this.begin + this.length;
	},
	
	get isEmpty() {
		return (this.length === 0);
	},
	
	toString: function() {
		return jsc.Utils.format("[%d..%d]", this.begin, this.end);
	}
});

Object.extend(jsc.TextSpan, {
	fromRange: function(begin, end) {
		return new jsc.TextSpan(begin, end - begin);
	}
});


jsc.TextPosition = Object.define({
	initialize: function(line, begin, lineBegin) {
		this.line = jsc.Utils.valueOrDefault(line, 0);
		this.lineBegin = jsc.Utils.valueOrDefault(lineBegin, 0);
		this.begin = jsc.Utils.valueOrDefault(begin, 0);
	},

	get column() {
		return (this.begin - this.lineBegin);
	},

	add: function(offset) {
		return new jsc.TextPosition(this.line, this.begin + offset, this.lineBegin);
	},

	subtract: function(offset) {
		return new jsc.TextPosition(this.line, this.begin - offset, this.lineBegin);
	},

	isEqualTo: function(other) {
		return (this.line === other.line && this.begin === other.begin && this.lineBegin === other.lineBegin);
	},

	isGreaterThan: function(other) {
		return (
			(this.line >= other.line && this.begin > other.begin) ||
			(this.begin >= other.begin && this.line > other.line));
	},

	isLessThan: function(other) {
		return (
			(this.line <= other.line && this.begin < other.begin) ||
			(this.begin <= other.begin && this.line < other.line));
	},

	copyTo: function(other) {
		other.line = this.line;
		other.lineBegin = this.lineBegin;
		other.begin = this.begin;
	},

	clone: function() {
		var pos = new jsc.TextPosition();
		this.copyTo(pos);

		return pos;
	},
	
	toString: function() {
		return jsc.Utils.format("%d,%d", this.line, this.begin - this.lineBegin);
	}
});

Object.extend(jsc.TextPosition, {
	get Zero() {
		return new jsc.TextPosition(0, 0);
	}
});


jsc.TextBuffer = Object.define({
	initialize: function(str, encoding, offset, length) {
		this.str = str;
		this.strlen = str.length;
		this.encoding = jsc.Utils.isStringNullOrEmpty(encoding) ? jsc.TextBuffer.ENCODING.UTF8 : encoding;
		this.startIndex = offset ? Math.max((this.strlen + offset) % this.strlen, 0) : 0;
		this.endIndex = (jsc.Utils.isInteger(length) ? Math.min(Math.max(length, 0) + this.startIndex, this.strlen) : this.strlen) - 1;
		this.source = null;
		this.buffer = null;
		this.bufferLength = this.strlen;
		
		var chStartIndex = this.startIndex;
		var chEndIndex = this.endIndex;
		var i;
		
		switch(this.encoding)
		{
			// UTF-8
			case jsc.TextBuffer.ENCODING.UTF8:
			{
				this.bufferLength = 0;
				
				for(i = 0; i < this.strlen; i++)
				{
					if(i === chStartIndex)
						this.startIndex = this.bufferLength;
						
					this.bufferLength += this.getCharLength(this.str.charCodeAt(i));

					if(i === chEndIndex)
						this.endIndex = this.bufferLength;
				}
				
				this.buffer = new Uint8Array(this.bufferLength);
				
				var chIndex = 0;
				
				for(i = 0; i < this.bufferLength; chIndex++)
					i = this.putChar(this.str.charCodeAt(chIndex), i);

				break;
			}
			// UTF-16
			case jsc.TextBuffer.ENCODING.UTF16:
				this.buffer = new Uint16Array(this.bufferLength);
				
				for(i = 0; i < this.bufferLength; i++)
					this.buffer[i] = this.str.charCodeAt(i);
				
				break;
				
			// ASCII
			default:
				this.buffer = new Uint8Array(this.bufferLength);
				
				for(i = 0; i < this.bufferLength; i++)
					this.buffer[i] = this.str.charCodeAt(i) & 0xFF;

				break;
		}
		
		this.source = (this.startIndex > 0 || this.endIndex < this.buffer.length - 1) ? this.buffer.subarray(this.startIndex, this.endIndex) : this.buffer;

		// make this buffer immutable
		Object.freeze(this);
	},
	
	get length() {
		return this.source.length;
	},

	getString: function(offset, len) {
		offset = jsc.Utils.valueOrDefault(offset, 0);
		len = jsc.Utils.valueOrDefault(len, this.source.length);

		if(this.encoding === jsc.TextBuffer.ENCODING.UTF8 || this.encoding === jsc.TextBuffer.ENCODING.UTF16)
		{
			var s = "";

			for(var ch, i = 0; i < len; i += this.getCharLength(ch))
			{
				ch = this.getCharCode(i+offset);
				s += String.fromCharCode(ch);
			}

			return s;
		}

		if(offset === 0 && len === this.source.length)
			return String.fromCharCode.apply(null, this.source);

		return String.fromCharCode.apply(null, this.source.subarray(offset, offset+len));
	},
	
	getCharLength: function(ch) {
		switch(this.encoding)
		{
			case jsc.TextBuffer.ENCODING.UTF16:
				return (ch < 0x10000 ? 1 : 2);
			default: // ASCII / UTF-8
				return (ch < 0x80 ? 1 : ch < 0x800 ? 2 : ch < 0x10000 ? 3 : ch < 0x200000 ? 4 : ch < 0x4000000 ? 5 : 6);
		}
	},
	
	getChar: function(index) {
		return String.fromCharCode(this.getCharCode(index));
	},
	
	getCharCode: function(index) {
		var len = this.source.length;
		var part = this.source[index];
		
		if(this.encoding === jsc.TextBuffer.ENCODING.UTF16)
		{
			if(part > 0xD7BF && index + 1 < len)
				return (part - 0xD800 << 10) + this.source[index+1] + 0x2400;

			return part;
		}
		
		if(part > 251 && part < 254 && index + 5 < len)
			return (part - 252) * 1073741824 + (this.source[index+1] - 128 << 24) + (this.source[index+2] - 128 << 18) + (this.source[index+3] - 128 << 12) + (this.source[index+4] - 128 << 6) + this.source[index+5] - 128;
		else if(part > 247 && part < 252 && index + 4 < len)
			return (part - 248 << 24) + (this.source[this.index+1] - 128 << 18) + (this.source[index+2] - 128 << 12) + (this.source[index+3] - 128 << 6) + this.source[index+4] - 128;
		else if(part > 239 && part < 248 && index + 3 < len)
			return (part - 240 << 18) + (this.source[index+1] - 128 << 12) + (this.source[index+2] - 128 << 6) + this.source[index+3] - 128;
		else if(part > 223 && part < 240 && index + 2 < len)
			return (part - 224 << 12) + (this.source[index+1] - 128 << 6) + this.source[index+2] - 128;
		else if(part > 191 && part < 224 && index + 1 < len)
			return (part - 192 << 6) + this.source[index+1] - 128;
		else
			return part;
	},
	
	putChar: function(ch, index) {
		var nextIndex = index;
		var code = jsc.Utils.isString(ch) ? ch.charCodeAt(0) : ch;
		
		switch(this.encoding)
		{
			case jsc.TextBuffer.ENCODING.UTF16:
				if(code < 0x10000)
					this.buffer[nextIndex++] = code;
				else
				{
					this.buffer[nextIndex++] = 0xD7C0 + (code >>> 10);
					this.buffer[nextIndex++] = 0xDC00 + (code & 0x3FF);
				}
				break;
			default: // ASCII / UTF-8
				if(code < 0x80)
					this.buffer[nextIndex++] = code;
				else if(code < 0x800)
				{
					this.buffer[nextIndex++] = 0xC0 + (code >>> 6);
					this.buffer[nextIndex++] = 0x80 + (code & 0x3F);
				}
				else if(code < 0x10000)
				{
					this.buffer[nextIndex++] = 0xE0 + (code >>> 12);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 6) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + (code & 0x3F);
				}
				else if(code < 0x200000)
				{
					this.buffer[nextIndex++] = 0xF0 + (code >>> 18);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 12) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 6) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + (code & 0x3F);
				}
				else if(code < 0x4000000)
				{
					this.buffer[nextIndex++] = 0xF8 + (code >>> 24);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 18) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 12) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 6) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + (code & 0x3F);
				}
				else
				{
					this.buffer[nextIndex++] = 0xFC + (code / 1073741824);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 24) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 18) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 12) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + ((code >>> 6) & 0x3F);
					this.buffer[nextIndex++] = 0x80 + (code & 0x3F);		
				}
				break;
		}
		
		return nextIndex;
	},
	
	forEach: function(callback /* (code, charIndex, bufferIndex, source) */, me) {
		var index = 0;
		var end = this.source.length;
		var code = 0;
		
		if(this.encoding === jsc.TextBuffer.ENCODING.UTF8 || this.encoding === jsc.TextBuffer.ENCODING.UTF16)
		{
			for(var i = 0; index < end; i++)
			{
				code = this.getCharCode(index);
				
				callback.call(me || null, code, i, index, this);
				index += this.getCharLength(code);
			}
		}
		else
		{
			for(index; index < end; index++)
				callback.call(me || null, this.source[index], index, index, this);
		}
	},
	
	valueOf: function() {
		return this.toString();
	},
	
	toString: function() {
		return this.getString();
	}
});


Object.extend(jsc.TextBuffer, {
	ENCODING: {
		ASCII: "ASCII",
		UTF8: "UTF-8",
		UTF16: "UTF-16"
	}
});


jsc.TextUtils = {
	isWhitespace: function(ch) {
		return (ch === '\u0020' || ch === '\u0009' || ch === '\u000B' || ch === '\u000C' || ch === '\u00A0' || ch === '\u180E' || ch === '\uFEFF');
	},
	
	isLineTerminator: function(ch) {
		return (ch === '\u000A' || ch === '\u000D' || ch === '\u2028' || ch === '\u2029');
	},
	
	isAlpha: function(ch) {
		return ((ch >= '\u0041' && ch <= '\u005A') || (ch >= '\u0061' && ch <= '\u007A'))
	},
	
	isDigit: function(ch) {
		return (ch >= '\u0030' && ch <= '\u0039');
	},
	
	isAlphaNumeric: function(ch) {
		return (jsc.TextUtils.isAlpha(ch) || jsc.TextUtils.isDigit(ch));
	},
	
	isHexDigit: function(ch) {
		return (jsc.TextUtils.isDigit(ch) || ((ch >= '\u0041' && ch <= '\u0046') || (ch >= '\u0061' && ch <= '\u0066')));
	},
	
	isOctalDigit: function(ch) {
		return (ch >= '\u0030' && ch <= '\u0037');
	},

	isBinaryDigit: function(ch) {
		return (ch === '0' || ch === '1');
	},
	
	isAscii: function(ch) {
		return (ch >= '\u0000' && ch <= '\u007F');
	},
	
	isLower: function(ch) {
		return (ch >= '\u0061' && ch <= '\u007A');
	},
	
	isUpper: function(ch) {
		return (ch >= '\u0041' && ch <= '\u005A');
	},
	
	getEscapeChar: function(ch) {
		switch(ch)
		{
			case 'b':
				return '\u0008';
			case 't':
				return '\u0009';
			case 'n':
				return '\u000A';
			case 'v':
				return '\u000B';
			case 'f':
				return '\u000C';
			case 'r':
				return '\u000D';
			case '\\':
				return '\u005C';
			case '\'':
				return '\u0027';
			case '"':
				return '\u0022';
			default:
				return 0;
		}
	}
};

module.exports = {
	TextSpan: jsc.TextSpan,
	TextPosition: jsc.TextPosition,
	TextBuffer: jsc.TextBuffer,
	TextUtils: jsc.TextUtils
};