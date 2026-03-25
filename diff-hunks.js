/*\
title: $:/plugins/rimir/diffsync/diff-hunks.js
type: application/javascript
module-type: library
\*/
"use strict";

var dmp = require("$:/core/modules/utils/diff-match-patch/diff_match_patch.js");

var DIFF_DELETE = -1;
var DIFF_INSERT = 1;
var DIFF_EQUAL = 0;

// --- Line-level diff ---

function lineDiff(sourceText, targetText) {
	var dmpObj = new dmp.diff_match_patch();
	var a = dmpObj.diff_linesToChars_(sourceText || "", targetText || "");
	var diffs = dmpObj.diff_main(a.chars1, a.chars2, false);
	dmpObj.diff_charsToLines_(diffs, a.lineArray);
	return diffs;
}

// --- Hunk computation ---

function computeHunks(sourceText, targetText, contextLines) {
	if (contextLines === undefined) contextLines = 3;
	var diffs = lineDiff(sourceText, targetText);
	if (diffs.length === 0) return [];

	// Split diff texts into individual lines, preserving the diff type
	var lines = [];
	for (var i = 0; i < diffs.length; i++) {
		var type = diffs[i][0];
		var text = diffs[i][1];
		// Split into individual lines (keep trailing newline with each line)
		var parts = text.split("\n");
		for (var j = 0; j < parts.length; j++) {
			var line = parts[j];
			// Don't add empty string after final newline
			if (j === parts.length - 1 && line === "") continue;
			var suffix = (j < parts.length - 1) ? "\n" : "";
			lines.push({
				type: type === DIFF_DELETE ? "delete" : type === DIFF_INSERT ? "insert" : "equal",
				text: line + suffix
			});
		}
	}

	if (lines.length === 0) return [];

	// Find change regions (runs of non-equal lines)
	var regions = [];
	var inChange = false;
	var changeStart = -1;
	for (var k = 0; k < lines.length; k++) {
		if (lines[k].type !== "equal") {
			if (!inChange) {
				changeStart = k;
				inChange = true;
			}
		} else {
			if (inChange) {
				regions.push({ start: changeStart, end: k - 1 });
				inChange = false;
			}
		}
	}
	if (inChange) {
		regions.push({ start: changeStart, end: lines.length - 1 });
	}

	if (regions.length === 0) return [];

	// Build hunks with context, merging overlapping contexts
	var hunks = [];
	var hunkId = 0;
	var prevEnd = -1;

	for (var r = 0; r < regions.length; r++) {
		var ctxStart = Math.max(0, regions[r].start - contextLines);
		var ctxEnd = Math.min(lines.length - 1, regions[r].end + contextLines);

		// Merge with previous hunk if context overlaps
		if (hunks.length > 0 && ctxStart <= prevEnd + 1) {
			var lastHunk = hunks[hunks.length - 1];
			// Extend the last hunk: add lines from prevEnd+1 to ctxEnd
			for (var m = prevEnd + 1; m <= ctxEnd; m++) {
				lastHunk.lines.push(lines[m]);
			}
			prevEnd = ctxEnd;
		} else {
			var hunkLines = [];
			for (var n = ctxStart; n <= ctxEnd; n++) {
				hunkLines.push(lines[n]);
			}
			hunks.push({ id: hunkId++, lines: hunkLines });
			prevEnd = ctxEnd;
		}
	}

	return hunks;
}

// --- Text reconstruction ---

function reconstructText(sourceText, targetText, hunks, selections) {
	var diffs = lineDiff(sourceText, targetText);

	// Flatten all lines from diffs
	var allLines = [];
	for (var i = 0; i < diffs.length; i++) {
		var type = diffs[i][0];
		var text = diffs[i][1];
		var parts = text.split("\n");
		for (var j = 0; j < parts.length; j++) {
			var line = parts[j];
			if (j === parts.length - 1 && line === "") continue;
			var suffix = (j < parts.length - 1) ? "\n" : "";
			allLines.push({
				type: type === DIFF_DELETE ? "delete" : type === DIFF_INSERT ? "insert" : "equal",
				text: line + suffix
			});
		}
	}

	// Build a map: line index → hunk id (for lines that are inside a hunk)
	var lineToHunk = {};
	var lineIdx = 0;
	var hunkLineIdx = 0;
	// Match hunk lines to allLines by walking both sequences
	for (var h = 0; h < hunks.length; h++) {
		var hunk = hunks[h];
		// Find where this hunk's first line matches in allLines
		var startSearch = hunkLineIdx;
		for (var s = startSearch; s < allLines.length; s++) {
			if (allLines[s].text === hunk.lines[0].text && allLines[s].type === hunk.lines[0].type) {
				// Verify full match
				var match = true;
				for (var v = 0; v < hunk.lines.length && s + v < allLines.length; v++) {
					if (allLines[s + v].text !== hunk.lines[v].text || allLines[s + v].type !== hunk.lines[v].type) {
						match = false;
						break;
					}
				}
				if (match) {
					for (var t = 0; t < hunk.lines.length; t++) {
						lineToHunk[s + t] = hunk.id;
					}
					hunkLineIdx = s + hunk.lines.length;
					break;
				}
			}
		}
	}

	// Reconstruct: walk all lines, applying selections
	var result = [];
	for (var l = 0; l < allLines.length; l++) {
		var line = allLines[l];
		var hunkId = lineToHunk[l];

		if (line.type === "equal") {
			result.push(line.text);
		} else if (hunkId !== undefined && selections[hunkId] === "source") {
			// User chose "use source" for this hunk
			if (line.type === "delete") result.push(line.text); // source line — keep
			// insert lines — skip (target-only, not wanted)
		} else {
			// Default: "use target"
			if (line.type === "insert") result.push(line.text); // target line — keep
			// delete lines — skip (source-only, not wanted)
		}
	}

	return result.join("");
}

// --- Field comparison ---

function isMultiline(val) {
	return typeof val === "string" && val.indexOf("\n") !== -1;
}

function compareFields(wiki, sourceTitle, targetTitle, contextLines) {
	var sourceTiddler = wiki.getTiddler(sourceTitle);
	var targetTiddler = wiki.getTiddler(targetTitle);
	var sourceFields = sourceTiddler ? sourceTiddler.fields : {};
	var targetFields = targetTiddler ? targetTiddler.fields : {};

	// Union of all field names
	var fieldNames = {};
	var key;
	for (key in sourceFields) {
		if (Object.prototype.hasOwnProperty.call(sourceFields, key)) fieldNames[key] = true;
	}
	for (key in targetFields) {
		if (Object.prototype.hasOwnProperty.call(targetFields, key)) fieldNames[key] = true;
	}

	var result = [];
	var sortedNames = Object.keys(fieldNames).sort();

	for (var i = 0; i < sortedNames.length; i++) {
		var field = sortedNames[i];
		// Skip title — always differs between source and target
		if (field === "title") continue;

		var sourceVal = sourceFields[field];
		var targetVal = targetFields[field];

		// Stringify for comparison
		var sourceStr = stringifyFieldValue(sourceVal);
		var targetStr = stringifyFieldValue(targetVal);

		// Skip identical fields
		if (sourceStr === targetStr) continue;

		var multiline = isMultiline(sourceStr) || isMultiline(targetStr);
		var entry = {
			field: field,
			sourceVal: sourceStr,
			targetVal: targetStr,
			sourceOnly: targetVal === undefined,
			targetOnly: sourceVal === undefined,
			isMultiline: multiline
		};

		if (multiline) {
			entry.hunks = computeHunks(sourceStr || "", targetStr || "", contextLines);
		}

		result.push(entry);
	}

	return result;
}

function stringifyFieldValue(val) {
	if (val === undefined) return undefined;
	if (val instanceof Date) {
		return $tw.utils.stringifyDate(val);
	}
	if (Array.isArray(val)) {
		return $tw.utils.stringifyList(val);
	}
	return String(val);
}

// --- Exports ---

exports.computeHunks = computeHunks;
exports.reconstructText = reconstructText;
exports.compareFields = compareFields;
exports.isMultiline = isMultiline;
exports.lineDiff = lineDiff;
exports.DIFF_DELETE = DIFF_DELETE;
exports.DIFF_INSERT = DIFF_INSERT;
exports.DIFF_EQUAL = DIFF_EQUAL;
