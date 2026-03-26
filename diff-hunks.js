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

	// Build hunks — one per change region, no merging.
	// Context lines are truncated at midpoint between adjacent regions to avoid overlap.
	var hunks = [];
	var hunkId = 0;

	for (var r = 0; r < regions.length; r++) {
		var ctxStart = Math.max(0, regions[r].start - contextLines);
		var ctxEnd = Math.min(lines.length - 1, regions[r].end + contextLines);

		// Truncate context to avoid overlapping with adjacent hunks
		if (r > 0) {
			var prevRegionEnd = regions[r - 1].end;
			var gap = regions[r].start - prevRegionEnd - 1;
			if (gap < contextLines * 2) {
				// Limit start context to half the gap (rounded down)
				ctxStart = Math.max(prevRegionEnd + 1 + Math.ceil(gap / 2), regions[r].start - contextLines);
				ctxStart = Math.min(ctxStart, regions[r].start);
			}
		}
		if (r < regions.length - 1) {
			var nextRegionStart = regions[r + 1].start;
			var gapAfter = nextRegionStart - regions[r].end - 1;
			if (gapAfter < contextLines * 2) {
				ctxEnd = Math.min(regions[r].end + Math.floor(gapAfter / 2), regions[r].end + contextLines);
				ctxEnd = Math.max(ctxEnd, regions[r].end);
			}
		}

		var hunkLines = [];
		for (var n = ctxStart; n <= ctxEnd; n++) {
			hunkLines.push(lines[n]);
		}
		hunks.push({ id: hunkId++, lines: hunkLines });
	}

	return hunks;
}

// --- Text reconstruction ---

function reconstructText(sourceText, targetText, hunks, selections) {
	// Re-run the same line-level diff used to create hunks
	var diffs = lineDiff(sourceText, targetText);

	// Flatten diffs into individual lines
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

	// Map change regions to hunk IDs.
	// With 1:1 region-to-hunk mapping (no merging), region N = hunk N.
	var changeRegions = [];
	var inChange = false;
	var changeStart = -1;
	for (var k = 0; k < allLines.length; k++) {
		if (allLines[k].type !== "equal") {
			if (!inChange) { changeStart = k; inChange = true; }
		} else {
			if (inChange) { changeRegions.push({ start: changeStart, end: k - 1 }); inChange = false; }
		}
	}
	if (inChange) changeRegions.push({ start: changeStart, end: allLines.length - 1 });

	var lineToHunkId = {};
	for (var r = 0; r < changeRegions.length && r < hunks.length; r++) {
		for (var m = changeRegions[r].start; m <= changeRegions[r].end; m++) {
			lineToHunkId[m] = hunks[r].id;
		}
	}

	// Reconstruct: walk all lines, applying selections
	var result = [];
	for (var l = 0; l < allLines.length; l++) {
		var line = allLines[l];
		if (line.type === "equal") {
			result.push(line.text);
		} else {
			var hId = lineToHunkId[l];
			if (hId !== undefined && selections[hId] === "source") {
				// "source" = keep source version for this hunk
				if (line.type === "delete") result.push(line.text);
				// skip insert lines
			} else {
				// default = keep target version
				if (line.type === "insert") result.push(line.text);
				// skip delete lines
			}
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

// --- Config helper ---

function getContextLines(wiki) {
	var tiddler = wiki.getTiddler("$:/config/rimir/diffsync/context-lines");
	return (tiddler && parseInt(tiddler.fields.text, 10)) || 3;
}

// --- Exports ---

exports.computeHunks = computeHunks;
exports.reconstructText = reconstructText;
exports.compareFields = compareFields;
exports.isMultiline = isMultiline;
exports.lineDiff = lineDiff;
exports.getContextLines = getContextLines;
exports.DIFF_DELETE = DIFF_DELETE;
exports.DIFF_INSERT = DIFF_INSERT;
exports.DIFF_EQUAL = DIFF_EQUAL;
