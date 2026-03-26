/*\
title: $:/plugins/rimir/diffsync/auto-refresh.js
type: application/javascript
module-type: startup
\*/
"use strict";

exports.name = "diffsync-auto-refresh";
exports.platforms = ["browser"];
exports.after = ["startup"];

exports.startup = function() {
	var diffHunks = require("$:/plugins/rimir/diffsync/diff-hunks.js");
	var RESULT = "$:/temp/diffsync/result";
	var STATE_SOURCE = "$:/state/diffsync/source";
	var STATE_TARGET = "$:/state/diffsync/target";
	var STATE_PREFIX_FIELD = "$:/state/diffsync/field/";

	$tw.wiki.addEventListener("change", function(changes) {
		// Only act if a comparison is active
		var resultTiddler = $tw.wiki.getTiddler(RESULT);
		if (!resultTiddler) return;
		var sourceTitle = resultTiddler.fields.source;
		var targetTitle = resultTiddler.fields.target;
		if (!sourceTitle || !targetTitle) return;
		// Check if either compared tiddler changed
		if (!changes[sourceTitle] && !changes[targetTitle]) return;
		// Re-compare
		var fieldDiffs = diffHunks.compareFields($tw.wiki, sourceTitle, targetTitle, diffHunks.getContextLines($tw.wiki));
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: RESULT,
			text: JSON.stringify(fieldDiffs),
			type: "application/json",
			source: sourceTitle,
			target: targetTitle
		}));
		// Clear stale selection states for fields/hunks that no longer exist
		var validKeys = {};
		for (var i = 0; i < fieldDiffs.length; i++) {
			var fd = fieldDiffs[i];
			validKeys[STATE_PREFIX_FIELD + fd.field] = true;
			if (fd.hunks) {
				for (var h = 0; h < fd.hunks.length; h++) {
					validKeys[STATE_PREFIX_FIELD + fd.field + "/hunk/" + fd.hunks[h].id] = true;
				}
			}
		}
		var stateTiddlers = $tw.wiki.filterTiddlers("[prefix[" + STATE_PREFIX_FIELD + "]]");
		for (var j = 0; j < stateTiddlers.length; j++) {
			if (!validKeys[stateTiddlers[j]]) {
				$tw.wiki.deleteTiddler(stateTiddlers[j]);
			}
		}
	});
};
