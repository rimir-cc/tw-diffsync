/*\
title: $:/plugins/rimir/diffsync/action-diffsync.js
type: application/javascript
module-type: widget
\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var RESULT_TIDDLER = "$:/temp/diffsync/result";
var STATE_PREFIX_FIELD = "$:/state/diffsync/field/";

var ActionDiffsync = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

ActionDiffsync.prototype = new Widget();

ActionDiffsync.prototype.render = function(parent, nextSibling) {
	this.computeAttributes();
	this.execute();
};

ActionDiffsync.prototype.execute = function() {
	this.actionOp = this.getAttribute("op", "compare");
	this.actionSource = this.getAttribute("source", "");
	this.actionTarget = this.getAttribute("target", "");
	this.actionDefaultSkip = this.getAttribute("default-skip", "no");
};

ActionDiffsync.prototype.refresh = function(changedTiddlers) {
	return this.refreshSelf();
};

ActionDiffsync.prototype.invokeAction = function(triggeringWidget, event) {
	var diffHunks = require("$:/plugins/rimir/diffsync/diff-hunks.js");
	var wiki = this.wiki;
	var op = this.actionOp;
	var sourceTitle = this.actionSource;
	var targetTitle = this.actionTarget;

	if (op === "compare") {
		if (!sourceTitle || !targetTitle) return true;
		var contextLines = diffHunks.getContextLines(wiki);
		// Compare fields
		var fieldDiffs = diffHunks.compareFields(wiki, sourceTitle, targetTitle, contextLines);
		// Store result
		wiki.addTiddler(new $tw.Tiddler({
			title: RESULT_TIDDLER,
			text: JSON.stringify(fieldDiffs),
			type: "application/json",
			source: sourceTitle,
			target: targetTitle
		}));
		// Clear all previous selection states
		clearSelections(wiki, fieldDiffs);
		// If default-skip="yes", pre-set all fields/hunks to "source" (skipped)
		if (this.actionDefaultSkip === "yes") {
			for (var d = 0; d < fieldDiffs.length; d++) {
				var fd = fieldDiffs[d];
				var stateKey = STATE_PREFIX_FIELD + fd.field;
				if (fd.isMultiline && fd.hunks) {
					for (var h = 0; h < fd.hunks.length; h++) {
						wiki.addTiddler(new $tw.Tiddler({
							title: stateKey + "/hunk/" + fd.hunks[h].id,
							text: "source"
						}));
					}
				} else {
					wiki.addTiddler(new $tw.Tiddler({
						title: stateKey,
						text: "source"
					}));
				}
			}
		}

	} else if (op === "apply" || op === "apply-to-source") {
		if (!sourceTitle || !targetTitle) return true;
		var resultTiddler = wiki.getTiddler(RESULT_TIDDLER);
		if (!resultTiddler) return true;
		var fieldDiffs;
		try {
			fieldDiffs = JSON.parse(resultTiddler.fields.text);
		} catch (e) {
			return true;
		}

		var applyTo = (op === "apply") ? targetTitle : sourceTitle;
		var tiddler = wiki.getTiddler(applyTo);
		if (!tiddler) return true;

		var updates = {};
		for (var i = 0; i < fieldDiffs.length; i++) {
			var fd = fieldDiffs[i];
			var fieldState = wiki.getTiddler(STATE_PREFIX_FIELD + fd.field);
			var singleLineSelection = fieldState ? fieldState.fields.text : "";

			if (fd.isMultiline && fd.hunks && fd.hunks.length > 0) {
				// Multiline: reconstruct text from hunk selections
				// Same reconstruction for both ops — only the write target differs
				var selections = {};
				for (var h = 0; h < fd.hunks.length; h++) {
					var hunkState = wiki.getTiddler(STATE_PREFIX_FIELD + fd.field + "/hunk/" + fd.hunks[h].id);
					if (hunkState && hunkState.fields.text === "source") {
						selections[fd.hunks[h].id] = "source";
					}
				}
				// Reconstruct: "source" hunks get sourceVal lines, others get targetVal lines
				var reconstructed = diffHunks.reconstructText(fd.sourceVal || "", fd.targetVal || "", fd.hunks, selections);
				// Only update if result differs from what's already in the target tiddler
				var currentVal = (op === "apply") ? fd.targetVal : fd.sourceVal;
				if (reconstructed !== (currentVal || "")) {
					updates[fd.field] = reconstructed;
				}
			} else {
				// Single-line field: "source" = use source value, default = use target value
				if (singleLineSelection === "source") {
					var newVal = fd.sourceVal !== undefined ? fd.sourceVal : "";
					var curVal = (op === "apply") ? fd.targetVal : fd.sourceVal;
					if (newVal !== (curVal || "")) {
						updates[fd.field] = newVal;
					}
				} else {
					var newVal = fd.targetVal !== undefined ? fd.targetVal : "";
					var curVal = (op === "apply") ? fd.targetVal : fd.sourceVal;
					if (newVal !== (curVal || "")) {
						updates[fd.field] = newVal;
					}
				}
			}
		}

		// Apply updates
		if (Object.keys(updates).length > 0) {
			wiki.addTiddler(new $tw.Tiddler(tiddler, updates));
		}
		// Re-compare to refresh the diff view
		var newDiffs = diffHunks.compareFields(wiki, sourceTitle, targetTitle, diffHunks.getContextLines(wiki));
		wiki.addTiddler(new $tw.Tiddler({
			title: RESULT_TIDDLER,
			text: JSON.stringify(newDiffs),
			type: "application/json",
			source: sourceTitle,
			target: targetTitle
		}));
		clearSelections(wiki, fieldDiffs);

	} else if (op === "clear") {
		// Clear comparison results and selections
		var existingResult = wiki.getTiddler(RESULT_TIDDLER);
		var existingDiffs = null;
		if (existingResult) {
			try { existingDiffs = JSON.parse(existingResult.fields.text); } catch (e) {}
		}
		wiki.deleteTiddler(RESULT_TIDDLER);
		clearSelections(wiki, existingDiffs);
	}

	return true;
};

function clearSelections(wiki, fieldDiffs) {
	// Delete selection state tiddlers by name (don't rely on filter enumeration)
	if (fieldDiffs) {
		for (var i = 0; i < fieldDiffs.length; i++) {
			var fd = fieldDiffs[i];
			var stateKey = STATE_PREFIX_FIELD + fd.field;
			wiki.deleteTiddler(stateKey);
			if (fd.hunks) {
				for (var h = 0; h < fd.hunks.length; h++) {
					wiki.deleteTiddler(stateKey + "/hunk/" + fd.hunks[h].id);
				}
			}
		}
	}
	// Also do a filter sweep as fallback
	var tiddlers = wiki.filterTiddlers("[prefix[" + STATE_PREFIX_FIELD + "]]");
	for (var j = 0; j < tiddlers.length; j++) {
		wiki.deleteTiddler(tiddlers[j]);
	}
}

exports["action-diffsync"] = ActionDiffsync;
