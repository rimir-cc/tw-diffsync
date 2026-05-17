/*\
title: $:/plugins/rimir/diffsync/test/test-action-diffsync.js
type: application/javascript
tags: [[$:/tags/test-spec]]
module-type: library
\*/
"use strict";

describe("diffsync: action-diffsync", function() {

	var RESULT_TIDDLER = "$:/temp/diffsync/result";
	var STATE_PREFIX_FIELD = "$:/state/diffsync/field/";

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	var ActionDiffsync = require("$:/plugins/rimir/diffsync/action-diffsync.js")["action-diffsync"];

	function invokeAction(wiki, attrs) {
		var parseTreeNode = {
			type: "action-diffsync",
			attributes: {}
		};
		for (var key in attrs) {
			if (Object.prototype.hasOwnProperty.call(attrs, key)) {
				parseTreeNode.attributes[key] = { type: "string", value: attrs[key] };
			}
		}
		var widget = new ActionDiffsync(parseTreeNode, { wiki: wiki, document: $tw.fakeDocument });
		widget.computeAttributes();
		widget.execute();
		widget.invokeAction(widget, {});
	}

	function getResult(wiki) {
		var t = wiki.getTiddler(RESULT_TIDDLER);
		if (!t) return null;
		try { return JSON.parse(t.fields.text); } catch(e) { return null; }
	}

	describe("op=compare", function() {

		it("should store field diffs as JSON in result tiddler", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello", custom: "old"},
				{title: "Target", text: "hello", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			var result = getResult(wiki);
			expect(result).not.toBeNull();
			var customDiff = result.filter(function(d) { return d.field === "custom"; });
			expect(customDiff.length).toBe(1);
			expect(customDiff[0].sourceVal).toBe("old");
			expect(customDiff[0].targetVal).toBe("new");
		});

		it("should store source and target titles on result tiddler", function() {
			var wiki = setupWiki([
				{title: "Source", text: "a"},
				{title: "Target", text: "b"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			var t = wiki.getTiddler(RESULT_TIDDLER);
			expect(t.fields.source).toBe("Source");
			expect(t.fields.target).toBe("Target");
			expect(t.fields.type).toBe("application/json");
		});

		it("should clear previous selection states on compare", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello", custom: "old"},
				{title: "Target", text: "hello", custom: "new"},
				{title: STATE_PREFIX_FIELD + "custom", text: "source"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			// The old state should be cleared (and re-created only if default-skip=yes)
			var state = wiki.getTiddler(STATE_PREFIX_FIELD + "custom");
			expect(state).toBeUndefined();
		});

		it("should do nothing when source is empty", function() {
			var wiki = setupWiki([
				{title: "Target", text: "hello"}
			]);
			invokeAction(wiki, {op: "compare", source: "", target: "Target"});
			expect(wiki.getTiddler(RESULT_TIDDLER)).toBeUndefined();
		});

		it("should do nothing when target is empty", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: ""});
			expect(wiki.getTiddler(RESULT_TIDDLER)).toBeUndefined();
		});

		it("should detect multiline text diffs with hunks", function() {
			var wiki = setupWiki([
				{title: "Source", text: "line1\nline2\nline3\n"},
				{title: "Target", text: "line1\nchanged\nline3\n"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			var result = getResult(wiki);
			var textDiff = result.filter(function(d) { return d.field === "text"; });
			expect(textDiff.length).toBe(1);
			expect(textDiff[0].isMultiline).toBe(true);
			expect(textDiff[0].hunks.length).toBeGreaterThan(0);
		});

		it("should return empty diffs for identical tiddlers", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", tags: "foo"},
				{title: "Target", text: "same", tags: "foo"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			var result = getResult(wiki);
			expect(result).not.toBeNull();
			expect(result.length).toBe(0);
		});
	});

	describe("op=compare with default-skip=yes", function() {

		it("should pre-set single-line fields to source", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target", "default-skip": "yes"});
			var state = wiki.getTiddler(STATE_PREFIX_FIELD + "custom");
			expect(state).toBeDefined();
			expect(state.fields.text).toBe("source");
		});

		it("should pre-set multiline hunk states to source", function() {
			var wiki = setupWiki([
				{title: "Source", text: "line1\nline2\nline3\n"},
				{title: "Target", text: "line1\nchanged\nline3\n"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target", "default-skip": "yes"});
			var result = getResult(wiki);
			var textDiff = result.filter(function(d) { return d.field === "text"; });
			expect(textDiff.length).toBe(1);
			for (var h = 0; h < textDiff[0].hunks.length; h++) {
				var hunkState = wiki.getTiddler(STATE_PREFIX_FIELD + "text/hunk/" + textDiff[0].hunks[h].id);
				expect(hunkState).toBeDefined();
				expect(hunkState.fields.text).toBe("source");
			}
		});

		it("should not pre-set states when default-skip is no", function() {
			var wiki = setupWiki([
				{title: "Source", custom: "old"},
				{title: "Target", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target", "default-skip": "no"});
			var state = wiki.getTiddler(STATE_PREFIX_FIELD + "custom");
			expect(state).toBeUndefined();
		});
	});

	describe("op=apply", function() {

		it("should apply target values to target by default (no selections)", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			// First compare
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			// Apply with no selections — target values stay (no-op)
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			var target = wiki.getTiddler("Target");
			expect(target.fields.custom).toBe("new");
		});

		it("should apply source value when field selection is source", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			// Set selection to source
			wiki.addTiddler({title: STATE_PREFIX_FIELD + "custom", text: "source"});
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			var target = wiki.getTiddler("Target");
			expect(target.fields.custom).toBe("old");
		});

		it("should reconstruct multiline text from hunk selections", function() {
			var wiki = setupWiki([
				{title: "Source", text: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"},
				{title: "Target", text: "1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10\n"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			var result = getResult(wiki);
			var textDiff = result.filter(function(d) { return d.field === "text"; });
			expect(textDiff[0].hunks.length).toBe(2);
			// Keep first hunk (TWO), revert second to source (9)
			wiki.addTiddler({title: STATE_PREFIX_FIELD + "text/hunk/" + textDiff[0].hunks[1].id, text: "source"});
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			var target = wiki.getTiddler("Target");
			expect(target.fields.text).toContain("TWO\n");
			expect(target.fields.text).toContain("9\n");
			expect(target.fields.text).not.toContain("NINE\n");
		});

		it("should re-compare after apply and update result tiddler", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			wiki.addTiddler({title: STATE_PREFIX_FIELD + "custom", text: "source"});
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			// After applying source value, source and target match — no more diffs
			var result = getResult(wiki);
			var customDiff = result.filter(function(d) { return d.field === "custom"; });
			expect(customDiff.length).toBe(0);
		});

		it("should do nothing when source is empty", function() {
			var wiki = setupWiki([
				{title: "Target", text: "hello"}
			]);
			wiki.addTiddler({title: RESULT_TIDDLER, text: "[]", type: "application/json"});
			invokeAction(wiki, {op: "apply", source: "", target: "Target"});
			expect(wiki.getTiddler("Target").fields.text).toBe("hello");
		});

		it("should do nothing when result tiddler is missing", function() {
			var wiki = setupWiki([
				{title: "Source", text: "a"},
				{title: "Target", text: "b"}
			]);
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			expect(wiki.getTiddler("Target").fields.text).toBe("b");
		});

		it("should do nothing when target tiddler is missing", function() {
			// Compare may have run when target existed; if the user deletes
			// target before clicking apply, the action must be a clean no-op
			// rather than crashing or creating a phantom tiddler.
			var wiki = setupWiki([{title: "Source", text: "hello"}]);
			wiki.addTiddler({
				title: RESULT_TIDDLER,
				text: '[{"field":"text","sourceVal":"hello","targetVal":"world","isMultiline":false}]',
				type: "application/json"
			});
			wiki.addTiddler({title: STATE_PREFIX_FIELD + "text", text: "source"});
			invokeAction(wiki, {op: "apply", source: "Source", target: "Target"});
			expect(wiki.getTiddler("Target")).toBeUndefined();
		});
	});

	describe("op=apply-to-source", function() {

		it("should apply target value to source when no selection", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			invokeAction(wiki, {op: "apply-to-source", source: "Source", target: "Target"});
			var source = wiki.getTiddler("Source");
			expect(source.fields.custom).toBe("new");
		});

		it("should keep source value when field selection is source", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "old"},
				{title: "Target", text: "same", custom: "new"}
			]);
			invokeAction(wiki, {op: "compare", source: "Source", target: "Target"});
			wiki.addTiddler({title: STATE_PREFIX_FIELD + "custom", text: "source"});
			invokeAction(wiki, {op: "apply-to-source", source: "Source", target: "Target"});
			var source = wiki.getTiddler("Source");
			// source selection means keep source value — no change
			expect(source.fields.custom).toBe("old");
		});
	});

	describe("op=clear", function() {

		it("should delete result tiddler", function() {
			var wiki = setupWiki([
				{title: RESULT_TIDDLER, text: "[]", type: "application/json"}
			]);
			invokeAction(wiki, {op: "clear", source: "Source", target: "Target"});
			expect(wiki.getTiddler(RESULT_TIDDLER)).toBeUndefined();
		});

		it("should delete all selection state tiddlers", function() {
			var wiki = setupWiki([
				{title: RESULT_TIDDLER, text: '[{"field":"custom","hunks":[{"id":0}]}]', type: "application/json"},
				{title: STATE_PREFIX_FIELD + "custom", text: "source"},
				{title: STATE_PREFIX_FIELD + "custom/hunk/0", text: "source"},
				{title: STATE_PREFIX_FIELD + "text", text: "source"}
			]);
			invokeAction(wiki, {op: "clear", source: "Source", target: "Target"});
			expect(wiki.getTiddler(STATE_PREFIX_FIELD + "custom")).toBeUndefined();
			expect(wiki.getTiddler(STATE_PREFIX_FIELD + "custom/hunk/0")).toBeUndefined();
			expect(wiki.getTiddler(STATE_PREFIX_FIELD + "text")).toBeUndefined();
		});

		it("should handle clear when no result tiddler exists", function() {
			var wiki = setupWiki();
			// Should not throw
			invokeAction(wiki, {op: "clear", source: "Source", target: "Target"});
			expect(wiki.getTiddler(RESULT_TIDDLER)).toBeUndefined();
		});
	});
});
