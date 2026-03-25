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
		// Read context lines from config
		var ctxTiddler = wiki.getTiddler("$:/config/rimir/diffsync/context-lines");
		var contextLines = (ctxTiddler && parseInt(ctxTiddler.fields.text, 10)) || 3;
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
		clearSelections(wiki);
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
				// Multiline field: reconstruct from hunk selections
				var selections = {};
				for (var h = 0; h < fd.hunks.length; h++) {
					var hunkState = wiki.getTiddler(STATE_PREFIX_FIELD + fd.field + "/hunk/" + fd.hunks[h].id);
					if (hunkState && hunkState.fields.text === "source") {
						selections[fd.hunks[h].id] = "source";
					}
				}
				var hasSourceSelections = Object.keys(selections).length > 0;
				if (op === "apply") {
					if (hasSourceSelections) {
						// Apply to target: reconstruct target text with source hunks mixed in
						updates[fd.field] = diffHunks.reconstructText(fd.sourceVal || "", fd.targetVal || "", fd.hunks, selections);
					}
				} else {
					// Apply to source: invert — swap source/target logic
					var invertedSelections = {};
					for (var j = 0; j < fd.hunks.length; j++) {
						if (!selections[fd.hunks[j].id]) {
							invertedSelections[fd.hunks[j].id] = "source";
						}
					}
					// If any hunks are accepted (inverted has entries), apply
					if (Object.keys(invertedSelections).length > 0) {
						updates[fd.field] = diffHunks.reconstructText(fd.targetVal || "", fd.sourceVal || "", fd.hunks, invertedSelections);
					}
				}
			} else {
				// Single-line field
				if (singleLineSelection === "source") {
					if (op === "apply") {
						updates[fd.field] = fd.sourceVal !== undefined ? fd.sourceVal : "";
					}
					// apply-to-source with "source" selection means keep source (no change)
				} else if (op === "apply-to-source" && singleLineSelection !== "source") {
					// Accepted: overwrite source field with target value
					updates[fd.field] = fd.targetVal !== undefined ? fd.targetVal : "";
				}
			}
		}

		// Apply updates if any
		if (Object.keys(updates).length > 0) {
			wiki.addTiddler(new $tw.Tiddler(tiddler, updates));
		}

	} else if (op === "clear") {
		// Clear comparison results and selections
		wiki.deleteTiddler(RESULT_TIDDLER);
		clearSelections(wiki);
	}

	return true;
};

function clearSelections(wiki) {
	var tiddlers = wiki.filterTiddlers("[prefix[" + STATE_PREFIX_FIELD + "]]");
	for (var i = 0; i < tiddlers.length; i++) {
		wiki.deleteTiddler(tiddlers[i]);
	}
}

exports["action-diffsync"] = ActionDiffsync;
