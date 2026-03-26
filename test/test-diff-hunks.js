/*\
title: $:/plugins/rimir/diffsync/test/test-diff-hunks.js
type: application/javascript
tags: [[$:/tags/test-spec]]
module-type: library
\*/
"use strict";

describe("diffsync: diff-hunks", function() {

	var diffHunks = require("$:/plugins/rimir/diffsync/diff-hunks.js");

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		wiki.addTiddlers(tiddlers || []);
		wiki.addIndexersToWiki();
		return wiki;
	}

	describe("computeHunks", function() {

		it("should return empty array for identical texts", function() {
			var hunks = diffHunks.computeHunks("hello\nworld\n", "hello\nworld\n");
			expect(hunks.length).toBe(0);
		});

		it("should return empty array for two empty strings", function() {
			var hunks = diffHunks.computeHunks("", "");
			expect(hunks.length).toBe(0);
		});

		it("should handle null/undefined inputs gracefully", function() {
			var hunks = diffHunks.computeHunks(null, null);
			expect(hunks.length).toBe(0);
		});

		it("should produce 1 hunk for a simple one-line change", function() {
			var source = "line1\nline2\nline3\n";
			var target = "line1\nchanged\nline3\n";
			var hunks = diffHunks.computeHunks(source, target, 1);
			expect(hunks.length).toBe(1);
			// Should contain delete and insert lines
			var hasDelete = false, hasInsert = false;
			for (var i = 0; i < hunks[0].lines.length; i++) {
				if (hunks[0].lines[i].type === "delete") hasDelete = true;
				if (hunks[0].lines[i].type === "insert") hasInsert = true;
			}
			expect(hasDelete).toBe(true);
			expect(hasInsert).toBe(true);
		});

		it("should produce multiple hunks for separated changes", function() {
			var source = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
			var target = "a\nB\nc\nd\ne\nf\ng\nh\nI\nj\n";
			// Changes at line 2 and line 9, with context=1 they should be separate
			var hunks = diffHunks.computeHunks(source, target, 1);
			expect(hunks.length).toBe(2);
		});

		it("should merge adjacent changes into one hunk", function() {
			var source = "a\nb\nc\nd\ne\n";
			var target = "a\nB\nC\nd\ne\n";
			var hunks = diffHunks.computeHunks(source, target, 1);
			expect(hunks.length).toBe(1);
		});

		it("should include context lines around changes", function() {
			var source = "a\nb\nc\nd\ne\n";
			var target = "a\nb\nX\nd\ne\n";
			var hunks = diffHunks.computeHunks(source, target, 2);
			expect(hunks.length).toBe(1);
			// Should have equal lines for context
			var equalLines = hunks[0].lines.filter(function(l) { return l.type === "equal"; });
			expect(equalLines.length).toBeGreaterThan(0);
		});

		it("should handle all-new text (source empty)", function() {
			var hunks = diffHunks.computeHunks("", "new line 1\nnew line 2\n");
			expect(hunks.length).toBeGreaterThan(0);
			// All change lines should be inserts (no deletes)
			var hasDelete = false;
			for (var h = 0; h < hunks.length; h++) {
				for (var i = 0; i < hunks[h].lines.length; i++) {
					if (hunks[h].lines[i].type === "delete") hasDelete = true;
				}
			}
			expect(hasDelete).toBe(false);
		});

		it("should handle all-deleted text (target empty)", function() {
			var hunks = diffHunks.computeHunks("old line 1\nold line 2\n", "");
			expect(hunks.length).toBeGreaterThan(0);
			// All change lines should be deletes (no inserts)
			var hasInsert = false;
			for (var h = 0; h < hunks.length; h++) {
				for (var i = 0; i < hunks[h].lines.length; i++) {
					if (hunks[h].lines[i].type === "insert") hasInsert = true;
				}
			}
			expect(hasInsert).toBe(false);
		});

		it("should default context lines to 3", function() {
			// 10 lines, change line 5 only. With 3 context, should get lines 2-8.
			var source = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
			var target = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9\n10\n";
			var hunks = diffHunks.computeHunks(source, target);
			expect(hunks.length).toBe(1);
			// Should have context equal lines
			var equalCount = hunks[0].lines.filter(function(l) { return l.type === "equal"; }).length;
			expect(equalCount).toBeGreaterThanOrEqual(3);
		});
	});

	describe("getContextLines", function() {

		it("should return default 3 when no config tiddler", function() {
			var wiki = setupWiki();
			var result = diffHunks.getContextLines(wiki);
			expect(result).toBe(3);
		});

		it("should read value from config tiddler", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/diffsync/context-lines", text: "5"}
			]);
			var result = diffHunks.getContextLines(wiki);
			expect(result).toBe(5);
		});

		it("should return 3 for invalid config value", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/diffsync/context-lines", text: "abc"}
			]);
			var result = diffHunks.getContextLines(wiki);
			expect(result).toBe(3);
		});

		it("should return 3 for empty config value", function() {
			var wiki = setupWiki([
				{title: "$:/config/rimir/diffsync/context-lines", text: ""}
			]);
			var result = diffHunks.getContextLines(wiki);
			expect(result).toBe(3);
		});
	});

	describe("reconstructText", function() {

		it("should return target text when all hunks default (target)", function() {
			var source = "a\nb\nc\n";
			var target = "a\nX\nc\n";
			var hunks = diffHunks.computeHunks(source, target, 1);
			var result = diffHunks.reconstructText(source, target, hunks, {});
			expect(result).toBe(target);
		});

		it("should return source text when all hunks selected as source", function() {
			var source = "a\nb\nc\n";
			var target = "a\nX\nc\n";
			var hunks = diffHunks.computeHunks(source, target, 1);
			var selections = {};
			for (var i = 0; i < hunks.length; i++) {
				selections[hunks[i].id] = "source";
			}
			var result = diffHunks.reconstructText(source, target, hunks, selections);
			expect(result).toBe(source);
		});

		it("should handle mixed selections correctly", function() {
			// Two separate changes: change line 2 and line 9
			var source = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
			var target = "1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10\n";
			var hunks = diffHunks.computeHunks(source, target, 1);
			expect(hunks.length).toBe(2);
			// Keep first hunk as target (TWO), revert second to source (9)
			var selections = {};
			selections[hunks[1].id] = "source";
			var result = diffHunks.reconstructText(source, target, hunks, selections);
			expect(result).toContain("TWO\n");
			expect(result).toContain("9\n");
			expect(result).not.toContain("2\n3\n"); // line 2 should be TWO, not 2
			expect(result).not.toContain("NINE\n");
		});

		it("should return target text when no hunks (identical texts)", function() {
			var text = "same\ntext\n";
			var hunks = diffHunks.computeHunks(text, text);
			var result = diffHunks.reconstructText(text, text, hunks, {});
			expect(result).toBe(text);
		});
	});

	describe("compareFields", function() {

		it("should detect modified fields", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello", custom: "old"},
				{title: "Target", text: "hello", custom: "new"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var customDiff = diffs.filter(function(d) { return d.field === "custom"; });
			expect(customDiff.length).toBe(1);
			expect(customDiff[0].sourceVal).toBe("old");
			expect(customDiff[0].targetVal).toBe("new");
		});

		it("should detect added fields (target only)", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello"},
				{title: "Target", text: "hello", extra: "value"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var extraDiff = diffs.filter(function(d) { return d.field === "extra"; });
			expect(extraDiff.length).toBe(1);
			expect(extraDiff[0].targetOnly).toBe(true);
			expect(extraDiff[0].sourceOnly).toBe(false);
		});

		it("should detect removed fields (source only)", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello", extra: "value"},
				{title: "Target", text: "hello"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var extraDiff = diffs.filter(function(d) { return d.field === "extra"; });
			expect(extraDiff.length).toBe(1);
			expect(extraDiff[0].sourceOnly).toBe(true);
			expect(extraDiff[0].targetOnly).toBe(false);
		});

		it("should skip the title field", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same"},
				{title: "Target", text: "same"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var titleDiff = diffs.filter(function(d) { return d.field === "title"; });
			expect(titleDiff.length).toBe(0);
		});

		it("should skip identical fields", function() {
			var wiki = setupWiki([
				{title: "Source", text: "same", custom: "same"},
				{title: "Target", text: "same", custom: "same"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var customDiff = diffs.filter(function(d) { return d.field === "custom"; });
			expect(customDiff.length).toBe(0);
		});

		it("should detect multiline vs single-line correctly", function() {
			var wiki = setupWiki([
				{title: "Source", text: "line1\nline2\n", custom: "one-liner"},
				{title: "Target", text: "line1\nchanged\n", custom: "different"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var textDiff = diffs.filter(function(d) { return d.field === "text"; });
			var customDiff = diffs.filter(function(d) { return d.field === "custom"; });
			expect(textDiff.length).toBe(1);
			expect(textDiff[0].isMultiline).toBe(true);
			expect(customDiff.length).toBe(1);
			expect(customDiff[0].isMultiline).toBe(false);
		});

		it("should include hunks for multiline fields", function() {
			var wiki = setupWiki([
				{title: "Source", text: "line1\nline2\nline3\n"},
				{title: "Target", text: "line1\nchanged\nline3\n"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "Target");
			var textDiff = diffs.filter(function(d) { return d.field === "text"; });
			expect(textDiff.length).toBe(1);
			expect(textDiff[0].hunks).toBeDefined();
			expect(textDiff[0].hunks.length).toBeGreaterThan(0);
		});

		it("should handle missing source tiddler", function() {
			var wiki = setupWiki([
				{title: "Target", text: "hello"}
			]);
			var diffs = diffHunks.compareFields(wiki, "NonExistent", "Target");
			expect(diffs.length).toBeGreaterThan(0);
		});

		it("should handle missing target tiddler", function() {
			var wiki = setupWiki([
				{title: "Source", text: "hello"}
			]);
			var diffs = diffHunks.compareFields(wiki, "Source", "NonExistent");
			expect(diffs.length).toBeGreaterThan(0);
		});
	});

	describe("isMultiline", function() {

		it("should return true for string with newline", function() {
			expect(diffHunks.isMultiline("hello\nworld")).toBe(true);
		});

		it("should return false for string without newline", function() {
			expect(diffHunks.isMultiline("hello world")).toBe(false);
		});

		it("should return false for empty string", function() {
			expect(diffHunks.isMultiline("")).toBe(false);
		});

		it("should return false for non-string values", function() {
			expect(diffHunks.isMultiline(null)).toBe(false);
			expect(diffHunks.isMultiline(undefined)).toBe(false);
			expect(diffHunks.isMultiline(42)).toBe(false);
		});
	});
});
