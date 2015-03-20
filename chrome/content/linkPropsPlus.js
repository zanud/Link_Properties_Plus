var linkPropsPlusSvc = {
	activeRequest: false,
	requestFinished: false,
	channel: null,
	realCount: 0,
	redirects: [],
	requestHash: "",

	// Block Escape key directly after request finished to don't close window instead of request cancellation
	blockEscapeKey: false,
	blockEscapeKeyTimer: 0,
	get blockEscapeKeyDelay() {
		return this.pu.get("blockEscapeKeyDelay");
	},

	get ut() {
		return window.linkPropsPlusUtils;
	},
	get pu() {
		return window.linkPropsPlusPrefUtils;
	},
	get wnd() {
		return window.linkPropsPlusWnd;
	},

	get ios() {
		delete this.ios;
		return this.ios = this.ut.ios;
	},
	get isOwnWindow() {
		delete this.isOwnWindow;
		return this.isOwnWindow = "linkPropsPlusWnd" in window;
	},
	get isDownloadDialog() {
		delete this.isDownloadDialog;
		return this.isDownloadDialog = "HelperApps" in window;
	},
	get isPropsDialog() {
		delete this.isPropsDialog;
		return this.isPropsDialog = "showMetadataFor" in window;
	},
	get windowType() {
		var wt;
		if(this.isOwnWindow)
			wt = "ownWindow";
		else if(this.isDownloadDialog)
			wt = "download";
		else if(this.isPropsDialog)
			wt = "properties";
		delete this.windowType;
		return this.windowType = wt;
	},
	get testResumability() {
		return this.pu.get("testDownloadResumability") && (
			!this.isDownloadDialog
			|| this.pu.get("testDownloadResumability.download")
		);
	},
	get canAutoClose() {
		delete this.canAutoClose;
		return this.canAutoClose = this.isOwnWindow || this.isPropsDialog;
	},
	get appInfo() {
		delete this.appInfo;
		return this.appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
			.getService(Components.interfaces.nsIXULAppInfo)
			.QueryInterface(Components.interfaces.nsIXULRuntime);
	},
	get fxVersion() {
		var pv = this.appInfo.platformVersion;
		// https://developer.mozilla.org/en-US/docs/Mozilla/Gecko/Versions
		var v = parseFloat(pv);
		if(v < 5) {
			var vc = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
				.getService(Components.interfaces.nsIVersionComparator);
			if(vc.compare(pv, "2.0a1pre") >= 0)
				v = 4.0;
			else if(vc.compare(pv, "1.9.2a1pre") >= 0)
				v = 3.6;
			else if(vc.compare(pv, "1.9.1a1pre") >= 0)
				v = 3.5;
			else if(vc.compare(pv, "1.9a1pre") >= 0)
				v = 3.0;
			else if(vc.compare(pv, "1.8.1a1pre") >= 0)
				v = 2.0;
			else //if(vc.compare(pv, "1.8a1pre") >= 0)
				v = 1.5;
		}
		delete this.fxVersion;
		return this.fxVersion = v;
	},
	$: function(id) {
		return document.getElementById(id);
	},

	instantInit: function() {
		window.addEventListener("load", this, false);
		if(this.fxVersion <= 2)
			document.documentElement.setAttribute("linkPropsPlus_collapseFrameHack", "true");
		this.isOwnWindow && this.wnd.instantInit();
	},
	init: function() {
		window.removeEventListener("load", this, false);
		window.addEventListener("unload", this, false);
		window.addEventListener("keypress", this, false);
		this.pu.init();
		this.showRows();
		setTimeout(function(_this) {
			_this.setKeysDesc();
		}, 0, this);

		this.initStyles();
		if(!this.isDownloadDialog)
			this.setRowHeight();

		if(this.isPropsDialog) {
			var showSep = false;
			for(
				var node = this.$("linkPropsPlus-container").parentNode.nextSibling;
				node && node.nodeType == node.ELEMENT_NODE;
				node = node.nextSibling
			) {
				var bo = node.boxObject;
				if(bo.width > 0 && bo.height > 0) {
					showSep = true;
					break;
				}
			}
			this.$("linkPropsPlus-separator").setAttribute("hidden", !showSep);

			var linkUrl = this.$("link-url");
			if(linkUrl) {
				var sep = linkUrl.firstChild;
				if(sep && sep.localName == "separator")
					this.$("linkPropsPlus-grid").style.marginLeft = sep.boxObject.width + "px";
			}
		}

		this.headers.init(this);
		this.initAutoClose();

		this.isOwnWindow && this.wnd.init();
		if(!this.isOwnWindow || this.wnd.autostart)
			this.getHeaders();
	},
	destroy: function() {
		window.removeEventListener("unload", this, false);
		window.removeEventListener("keypress", this, false);
		this.headers.destroy();
		this.destroyAutoClose();
		this.isOwnWindow && this.wnd.destroy();
		this.cancelCheckChannelResumable();
		this._requestSection = null;
		if(!this.channel)
			return;
		this.channel.cancel(Components.results.NS_BINDING_ABORTED);
		this.channel = null;
	},
	handleEvent: function(e) {
		switch(e.type) {
			case "load":     this.init();          break;
			case "unload":   this.destroy();       break;
			case "keypress": this.handleHotkey(e); break;
			case "mouseover":
			case "mouseout":
				if(
					!e.relatedTarget
					&& e.view == window // Ignore headers frame
				)
					this[e.type == "mouseover" ? "windowOver" : "windowOut"]();
			break;
			case "mousemove":
				window.removeEventListener(e.type, this, false);
				this.windowOver();
			break;
			case "mouseup":
				// mousedown and "drag" anything outside the window
				// -> mouseout from window => windowOut()
				// -> move mouse => wrong mouseover => windowOver()
				if(e.target == document)
					this.windowOut();
		}
	},
	handleHotkey: function(e) {
		if("defaultPrevented" in e ? e.defaultPrevented : e.getPreventDefault())
			return;
		this.restartAutoClose();
		if(e.altKey || e.metaKey)
			return;
		if(e.keyCode == e.DOM_VK_RETURN && this.isOwnWindow) { // Enter, Ctrl+Enter or Shift+Enter pressed
			this.stopEvent(e);
			this.wnd.getHeaders(e);
		}
		else if(!e.shiftKey && !e.ctrlKey && e.keyCode == e.DOM_VK_ESCAPE) { // Escape pressed
			if(this.cancel())
				this.stopEvent(e);
			else if(this.blockEscapeKey) {
				this.blockEscapeKey = false; // Second press will close window anyway
				clearTimeout(this.blockEscapeKeyTimer);
				this.stopEvent(e);
			}
		}
	},
	stopEvent: function(e) {
		e.preventDefault();
		e.stopPropagation();
	},
	setRowHeight: function() {
		var container = this.$("linkPropsPlus-container");
		var tb = this.$("linkPropsPlus-directURI");
		var btnSt1 = this.$("linkPropsPlus-goToDirectURI").style;
		var btnSt2 = this.$("linkPropsPlus-downloadDirectURI").style;
		var rowDirectURI = this.$("linkPropsPlus-rowDirectURI");

		var hidden = container.getAttribute("hidden") == "true";
		hidden && container.removeAttribute("hidden");
		var rowHidden = rowDirectURI.getAttribute("hidden") == "true";
		rowHidden && rowDirectURI.removeAttribute("hidden");
		btnSt1.marginTop = btnSt2.marginTop = btnSt1.marginBottom = btnSt2.marginBottom = "";
		tb.removeAttribute("lpp_empty");
		tb.parentNode.removeAttribute("lpp_empty");

		var margin = this.$("linkPropsPlus-rowSize").boxObject.height
			- this.$("linkPropsPlus-rowDirectURI").boxObject.height;
		btnSt1.marginTop = btnSt2.marginTop = margin + "px";
		btnSt1.marginBottom = btnSt2.marginBottom = "-1px";

		var empty = !tb.value;
		tb.setAttribute("lpp_empty", empty);
		tb.parentNode.setAttribute("lpp_empty", empty);
		rowHidden && rowDirectURI.setAttribute("hidden", "true");
		hidden && container.setAttribute("hidden", "true");
	},
	initStyles: function() {
		var root = document.documentElement;
		var showButtons = this.isDownloadDialog ? 0 : this.pu.get("showLinkButtons");
		root.setAttribute("linkPropsPlus_showButtons",       showButtons > 0);
		root.setAttribute("linkPropsPlus_showButtonsAlways", showButtons > 1);
		setTimeout(function() {
			var isDarkBG = false;
			var bg = window.getComputedStyle(root, null).backgroundColor;
			if(/^rgb\((\d+), *(\d+), *(\d+)\)$/.test(bg)) {
				var r = +RegExp.$1, g = +RegExp.$2, b = +RegExp.$3;
				var brightness = Math.max(r/255, g/255, b/255); // HSV, 0..1
				isDarkBG = brightness < 0.4;
			}
			root.setAttribute("linkPropsPlus_darkBackground", isDarkBG);
		}, 0);
	},
	showRows: function() {
		this.showRow("Status", "showResponseStatus");
		this.showRow("DirectURI", "showDirectURI");
		this.showRow("Headers", "showHttpHeaders");
	},
	showRow: function(rowId, pName) {
		var row = this.$("linkPropsPlus-row" + rowId);
		if(
			this.isPropsDialog && this.pu.get("properties." + pName)
			|| this.isDownloadDialog && this.pu.get("download." + pName)
			|| this.isOwnWindow && this.pu.get("ownWindow." + pName)
		)
			row.removeAttribute("hidden");
		else
			row.setAttribute("hidden", "true");
	},
	_rowsVisibilityChangedTimer: 0,
	rowsVisibilityChanged: function() {
		clearTimeout(this._rowsVisibilityChangedTimer);
		this._rowsVisibilityChangedTimer = setTimeout(function(_this) {
			_this._rowsVisibilityChanged();
		}, 20, this);
	},
	_rowsVisibilityChanged: function() {
		var rowHeaders = this.$("linkPropsPlus-rowHeaders");
		if(rowHeaders.getAttribute("hidden") != "true")
			rowHeaders.setAttribute("minheight", rowHeaders.boxObject.height);
		this.showRows();
		if(this.isOwnWindow) {
			// Unfortunately sizeToContent() works buggy with many flexible nodes
			setTimeout(function(_this) { // Small delay to reduce flickers
				window.resizeTo(window.outerWidth, 100); // This allows decrease height of window
				_this.wnd.fixWindowHeight();
				rowHeaders.removeAttribute("minheight");
			}, 0, this);
		}
		else {
			window.sizeToContent();
			rowHeaders.removeAttribute("minheight");
		}
	},
	setKeysDesc: function() {
		var nodes = Array.slice(document.getElementsByAttribute("lpp_key", "*"));
		//~ hack: show fake hidden popup with <menuitem key="keyId" /> to get descriptions
		var mp = document.documentElement.appendChild(document.createElement("menupopup"));
		mp.style.visibility = "collapse";
		nodes.forEach(function(node) {
			var keyId = node.getAttribute("lpp_key");
			if(!keyId)
				return;
			var mi = document.createElement("menuitem");
			mi.__node = node;
			mi.setAttribute("key", keyId);
			mp.appendChild(mi);
		});
		mp._onpopupshown = function() {
			Array.forEach(
				this.childNodes,
				function(mi) {
					var keyDesk = mi.getAttribute("acceltext");
					if(!keyDesk)
						return;
					var node = mi.__node;
					node.tooltipText = node.tooltipText
						? node.tooltipText + " (" + keyDesk + ")"
						: keyDesk;
				}
			);
			this.parentNode.removeChild(this);
		};
		mp.setAttribute("onpopupshown", "this._onpopupshown();");
		mp["openPopup" in mp ? "openPopup" : "showPopup"]();
	},
	prefsChanged: function(pName, pVal) {
		if(
			pName == this.windowType + ".showResponseStatus"
			|| pName == this.windowType + ".showDirectURI"
			|| pName == this.windowType + ".showHttpHeaders"
		)
			this.rowsVisibilityChanged();
		else if(
			pName == "sizePrecision"
			|| pName == "useBinaryPrefixes"
			|| pName == "localeNumbers"
		)
			this.convertSize();
		else if(pName == "localeDates")
			this.formatDate();
		else if(pName == "decodeURIs") {
			this.formatURI();
			if(this.isOwnWindow)
				this.wnd.setTitle();
		}
		else if(pName == "testDownloadResumability") {
			if(this.testResumability)
				this.checkChannelResumable(this.channel);
		}
		else if(pName == "testDownloadResumability.download") {
			if(this.isDownloadDialog && this.testResumability)
				this.checkChannelResumable(this.channel);
		}
		else if(
			pName == "showCaptionsInHttpHeaders"
			|| pName == "testDownloadResumability.showHttpHeaders"
			|| pName == "showRequestHeadersDiff"
		)
			this.headers.initStyles();
		else if(pName == "showLinkButtons")
			this.initStyles();
		else if(pName.substr(0, 10) == "autoClose.")
			this.reinitAutoClose();
	},
	getHeaders: function(opts, bypassCache, forceTestResumability, requestMethod) {
		var clear = opts;
		if(
			opts
			&& typeof opts == "object"
			&& arguments.length == 1
		) {
			clear                 = opts.clear                 || undefined;
			bypassCache           = opts.bypassCache           || undefined;
			forceTestResumability = opts.forceTestResumability || undefined;
			requestMethod         = opts.requestMethod         || undefined;
		}
		if(clear)
			this.clearResults();
		if(this.request(bypassCache, requestMethod)) {
			this.$("linkPropsPlus-container").removeAttribute("hidden");
			this.restartAutoClose();
			this.$("linkPropsPlus-rowHeaders").setAttribute(
				"lpp_notAvailable",
				!(this.channel instanceof Components.interfaces.nsIHttpChannel)
			);
			if((forceTestResumability || this.testResumability) && !requestMethod) {
				setTimeout(function(_this, channel) {
					_this.checkChannelResumable(channel);
				}, 0, this, this.channel);
			}
		}
	},
	sendGetRequest: function() {
		var svc = window.linkPropsPlusWnd || this;
		svc.getHeaders({ requestMethod: "GET" });
	},
	clearResults: function() {
		Array.forEach(
			this.$("linkPropsPlus-container").getElementsByTagName("textbox"),
			function(tb) {
				if(!tb.readOnly)
					return;
				tb.value = "";
				this.setMissingStyle(tb, false);
				tb.removeAttribute("tooltiptext");
				tb.setAttribute("lpp_empty", "true");
				tb.parentNode.setAttribute("lpp_empty", "true");
			},
			this
		);
		this._headers = { __proto__: null };
		this._requestSection = null;
		this.headers.clear();

		var grid = this.$("linkPropsPlus-grid");
		grid.removeAttribute("lpp_canResumeDownload");
		grid.removeAttribute("lpp_resumeDownloadTested");
		var status = this.$("linkPropsPlus-status");
		status.removeAttribute("lpp_canResumeDownload");
		status.removeAttribute("lpp_resumeDownloadTested");

		this.realCount = 0;
		this._lastSize = this._lastSizeTip = null;
		this._lastDate = null;
		this.redirects.length = 0;
	},
	_contextNode: null,
	get contextNode() {
		return this._contextNode
			|| this.$("linkPropsPlus-context").triggerNode
			|| document.popupNode;
	},
	get sendGetItem() {
		delete this.sendGetItem;
		return this.sendGetItem = this.$("linkPropsPlus-context-sendGetRequest");
	},
	initContextMenu: function(e) {
		if(!this._allowOptions)
			return false;
		var popup = e.currentTarget;
		var trg = this.contextNode;
		var row = this.getRowFromChild(trg);
		var tip = this.getTip(row);
		var copyTip = this.$("linkPropsPlus-context-copyTip");
		copyTip.hidden = !tip;
		if(tip)
			copyTip.tooltipText = tip;
		else
			copyTip.removeAttribute("tooltiptext");

		var rowStatus = this.$("linkPropsPlus-rowStatus");
		var testResume = this.$("linkPropsPlus-context-testDownloadResumability");
		var hideTestResume = testResume.hidden =
			!this.pu.get("testDownloadResumability.alwaysShowMenuItem")
			&& (this.testResumability || rowStatus.boxObject.height <= 0);
		if(!hideTestResume)
			testResume.disabled = !this.uri || this.checkResumableChannel;
		this.sendGetItem.disabled = this.activeRequest || !this.isHttp;

		return true;
	},
	showContextMenu: function() {
		this._allowOptions = true;
		var cd = document.commandDispatcher;
		var fe = cd.focusedElement;
		if(cd.focusedWindow && cd.focusedWindow.location.href == "chrome://linkpropsplus/content/headers.html")
			fe = this.headers.frame;
		var row = this.getRowFromChild(fe);
		if(!row || row.parentNode.id != "linkPropsPlus-rows") {
			var rows = this.$("linkPropsPlus-rows").childNodes;
			for(var i = 0, l = rows.length; i < l; ++i) {
				var r = rows[i];
				if(r.boxObject.height > 0) {
					row = r;
					break;
				}
			}
		}
		this._contextNode = row;
		var cm = this.$("linkPropsPlus-context");
		if("openPopup" in cm)
			cm.openPopup(row, "after_start");
		else
			cm.showPopup(row, -1, -1, "popup", "bottomleft", "topleft");
	},
	openOptions: function(paneId) {
		var win = this.ut.wm.getMostRecentWindow("linkPropsPlus:optionsWindow");
		var showPane = paneId && function showPane(e) {
			e && win.removeEventListener(e.type, showPane, false);
			var doc = win.document;
			var pane = doc.getElementById(paneId);
			pane && doc.documentElement.showPane(pane);
		};
		if(win) {
			win.focus();
			if("linkPropsPlusOpts" in win)
				win.linkPropsPlusOpts.highlight(window);
			showPane && showPane();
			return;
		}
		win = window.openDialog(
			"chrome://linkpropsplus/content/options.xul",
			"_blank",
			"chrome,toolbar,titlebar,centerscreen"
		);
		showPane && win.addEventListener("load", showPane, false);
	},
	openOptionsClick: function(e) {
		var inLeftCol = this.isClickOnLeftCol(e);
		if(e.type == "mousedown")
			this._allowOptions = inLeftCol;
		else if(e.type == "click" && e.button == 1 && inLeftCol)
			this.openOptions();
		else if(e.type == "dblclick" && e.button == 0 && this._allowOptions)
			this.openOptions();
	},
	isClickOnLeftCol: function(e) {
		var col = this.$("linkPropsPlus-columnLabels");
		var bo = col.boxObject;
		return e.screenX >= bo.screenX && e.screenX <= bo.screenX + bo.width
		    && e.screenY >= bo.screenY && e.screenY <= bo.screenY + bo.height;
	},
	getRowFromChild: function(node) {
		for(var row = node; row; row = row.parentNode)
			if(row.localName == "row")
				return row;
		return null;
	},
	copy: function(node) {
		var rows;
		if(node) {
			var row = this.getRowFromChild(node);
			if(row)
				rows = [row];
		}
		else {
			rows = Array.filter(
				this.$("linkPropsPlus-rows").childNodes,
				function(row) {
					var bo = row.boxObject;
					return bo.width > 0 && bo.height > 0;
				}
			);
		}
		var lines = rows.map(function(row) {
			var field = this.getField(row);
			var data = field.value || this.getFrameText(field);
			return row.getElementsByTagName("label")[0].getAttribute("value")
				+ (data.indexOf("\n") == -1 ? " " : "\n") + data;
		}, this);
		this.copyString(lines.join("\n"));
	},
	getField: function(row) {
		return row.getElementsByTagName("textbox")[0]
			|| row.getElementsByTagName("browser")[0];
	},
	getFrameText: function(frame) {
		var win = frame.contentWindow;
		var doc = win.document;
		// Note: doc.body.textContent doesn't contain newlines
		var sel = win.getSelection();
		var rng = doc.createRange();
		rng.selectNodeContents(doc.body);
		// Note: rng.toString() doesn't contain newlines
		// Save original selection
		var ranges = [];
		for(var i = 0, l = sel.rangeCount; i < l; ++i)
			ranges.push(sel.getRangeAt(i));
		sel.removeAllRanges();
		sel.addRange(rng);
		var data = sel.toString();
		// Restore original selection
		sel.removeAllRanges();
		ranges.forEach(function(rng) {
			sel.addRange(rng);
		});
		return data;
	},
	getTip: function(row) {
		return row && this.getField(row).tooltipText || "";
	},
	copyTip: function(node) {
		var tip = (this.getTip(this.getRowFromChild(node)) || "")
			.replace(/\s+$/mg, "");
		this.copyString(tip);
	},
	copyString: function(s) {
		s = s.replace(/\r\n?|\n/g, this.appInfo.OS == "WINNT" ? "\r\n" : "\n");
		Components.classes["@mozilla.org/widget/clipboardhelper;1"]
			.getService(Components.interfaces.nsIClipboardHelper)
			.copyString(s, this.sourceDocument || document);
	},
	get parentWindow() {
		if(this.isOwnWindow)
			return this.wnd.parentWindow;
		if(
			this.isPropsDialog
			&& "nodeView" in window
			&& window.opener && this.ensureWindowOpened(opener)
			&& "gBrowser" in opener && opener.gBrowser
			&& "_getTabForContentWindow" in opener.gBrowser
		) {
			var tab = this._parentTab = opener.gBrowser._getTabForContentWindow(nodeView);
			return tab && tab.ownerDocument.defaultView;
		}
		return null;
	},
	_parentTab: null,
	get parentTab() {
		var tab = this.isOwnWindow ? this.wnd.parentTab : this._parentTab;
		if(tab && tab.parentNode && !tab.hidden && !tab.collapsed && !tab.closing)
			return tab;
		return null;
	},
	get isOldAddTab() {
		delete this.isOldAddTab;
		return this.isOldAddTab = this.appInfo.name == "SeaMonkey"
			? this.fxVersion < 4
			: this.fxVersion < 3.6;
	},
	goToURI: function(textboxId, invertCloseBehavior) {
		var tb = this.$("linkPropsPlus-" + textboxId);
		var uri = tb
			? tb.getAttribute("lpp_rawURI") || tb.value
			: this.uri;
		if(!uri)
			return;

		if(this.appInfo.name == "Thunderbird") {
			var mailWin = this.ut.wm.getMostRecentWindow("mail:3pane");
			if(mailWin) {
				mailWin.openLinkExternally(uri);
				this.closeWindow(invertCloseBehavior) && window.close();
				return;
			}
			mailWin = this.openInWindow("about:blank");
			var _this = this;
			var args = arguments;
			mailWin.addEventListener("load", function goToURI() {
				mailWin.removeEventListener("load", goToURI, false);
				_this.goToURI.apply(_this, args);
			}, false);
			return;
		}

		this.closeWindow(invertCloseBehavior) && window.close();

		var parentWindow = this.parentWindow;
		var browserWin = parentWindow
			&& parentWindow.document.documentElement.getAttribute("windowtype") == "navigator:browser"
			? parentWindow
			: this.ut.wm.getMostRecentWindow("navigator:browser");

		if(browserWin && "gBrowser" in browserWin) {
			browserWin.focus();
			var gBrowser = browserWin.gBrowser;

			var parentTab = this.parentTab;
			var openAsChild = parentTab
				&& browserWin == parentWindow
				&& this.pu.get("openInChildTab")
				&& (
					!this.pu.get("openInChildTab.onlyIfSelected")
					|| parentTab.hasAttribute("selected")
				);
			if(openAsChild) {
				gBrowser.selectedTab = parentTab;

				// Open a new tab as a child of the current tab (Tree Style Tab)
				// http://piro.sakura.ne.jp/xul/_treestyletab.html.en#api
				if("TreeStyleTabService" in browserWin)
					browserWin.TreeStyleTabService.readyToOpenChildTab(parentTab);

				// Tab Kit https://addons.mozilla.org/firefox/addon/tab-kit/
				// TabKit 2nd Edition https://addons.mozilla.org/firefox/addon/tabkit-2nd-edition/
				if("tabkit" in browserWin) {
					var hasTabKit = true;
					browserWin.tabkit.addingTab("related");
				}
			}

			// https://github.com/Infocatcher/Private_Tab#privatetabreadytoopentab
			if("privateTab" in browserWin)
				browserWin.privateTab.readyToOpenTab(this.isPrivate);
			if(this.isOldAddTab)
				gBrowser.selectedTab = gBrowser.addTab(uri, this.refererURI || undefined);
			else {
				gBrowser.selectedTab = gBrowser.addTab(uri, {
					referrerURI: this.refererURI || undefined,
					relatedToCurrent: !!openAsChild
				});
			}

			hasTabKit && browserWin.tabkit.addingTabOver();
		}
		else {
			this.openInWindow(uri);
		}
	},
	saveLink: function(textboxId, invertCloseBehavior) {
		var tb = this.$("linkPropsPlus-" + textboxId);
		var uri = tb
			? tb.getAttribute("lpp_rawURI") || tb.value
			: this.uri;
		if(!uri)
			return;
		if(tb) {
			if(tb.getAttribute("disabled") == "true")
				return;
			var delay = Math.max(300, this.pu.getPref("browser.download.saveLinkAsFilenameTimeout") || 0);
			tb.setAttribute("disabled", "true");
			setTimeout(function(tb) {
				tb.removeAttribute("disabled");
			}, delay, tb);
		}

		var browserWin = this.ut.wm.getMostRecentWindow("navigator:browser")
			|| this.ut.wm.getMostRecentWindow("mail:3pane");
		if(!browserWin) {
			browserWin = this.openInWindow("about:blank");
			var _this = this;
			var args = arguments;
			browserWin.addEventListener("load", function save() {
				browserWin.removeEventListener("load", save, false);
				_this.save(browserWin, uri);
			}, false);
			return;
		}
		this.closeWindow(invertCloseBehavior) && window.close();
		this.save(browserWin, uri);
	},
	save: function(browserWin, uri) {
		// Hack: we use nsContextMenu.saveLink() from chrome://browser/content/nsContextMenu.js
		// to get correct name (see http://kb.mozillazine.org/Browser.download.saveLinkAsFilenameTimeout)
		var browserDoc = browserWin.document;
		//~ todo: content is null with Electrolysis w/o compatibility shims
		var content = this.sourceWindow || browserWin.content;
		var contentDoc = content.document;
		var linkDoc = "gMultiProcessBrowser" in browserWin && browserWin.gMultiProcessBrowser
			? browserDoc
			: contentDoc;
		var link = linkDoc.createElementNS("http://www.w3.org/1999/xhtml", "a");
		link.href = uri;
		var fakeDoc = {
			nodePrincipal: contentDoc.nodePrincipal,
			documentURI: this.referer,
			documentURIObject: this.refererURI || null,
			defaultView: content,
			__proto__: contentDoc
		};
		browserDoc.popupNode = link;
		try {
			link = link.wrappedJSObject || link;
			Object.__defineGetter__.call(link, "ownerDocument", function() {
				return fakeDoc;
			});
			//~ todo: doesn't work with Electrolysis
			new browserWin.nsContextMenu(
				browserDoc.getElementById("contentAreaContextMenu")
					|| browserDoc.getElementById("mailContext"),
				browserWin.gBrowser
			).saveLink();
		}
		catch(e) {
			this.ut.error("new nsContextMenu( ... ).saveLink() failed, will try saveURL()");
			Components.utils.reportError(e);
			try {
				// See chrome://global/content/contentAreaUtils.js
				// "aSourceDocument" argument is only for nsILoadContext.usePrivateBrowsing for now
				browserWin.saveURL(uri, null, null, true, false, this.refererURI, contentDoc);
			}
			catch(e2) {
				this.ut.error("saveURL() failed");
				Components.utils.reportError(e2);
			}
		}
		browserDoc.popupNode = null;
	},
	get browserURL() {
		var browserURL = this.pu.getPref("browser.chromeURL");
		if(!browserURL) switch(this.appInfo.name) {
			case "Thunderbird": browserURL = "chrome://messenger/content/"; break;
			case "SeaMonkey":   browserURL = "chrome://navigator/content/"; break;
			default:            browserURL = "chrome://browser/content/";
		}
		delete this.browserURL;
		return this.browserURL = browserURL;
	},
	openInWindow: function(uri) {
		return window.openDialog(
			this.browserURL,
			"_blank",
			"chrome,all,dialog=no",
			uri,
			null,
			this.refererURI || null,
			null,
			false
		);
	},
	closeWindow: function(invertCloseBehavior) {
		var close = this.pu.get("closeAfterOpen");
		if(typeof invertCloseBehavior == "object") {
			var e = invertCloseBehavior;
			invertCloseBehavior = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey;
		}
		if(invertCloseBehavior)
			close = !close;
		return close;
	},

	request: function(bypassCache, requestMethod) {
		var _uri = this.requestURI = this.uri;
		if(!_uri)
			return false;

		this._lastSize = this._lastSizeTip = null;
		this._lastDate = null;
		this._hasSize = this._hasType = false;
		delete this._isPrivateOverrided;

		if(this.isDownloadDialog) {
			var dl = dialog.mLauncher;
			if("contentLength" in dl && dl.contentLength) // https://bugzilla.mozilla.org/show_bug.cgi?id=455913
				this.formatSize(dl.contentLength);
			if("MIMEInfo" in dl) {
				var mi = dl.MIMEInfo;
				if("MIMEType" in mi && mi.MIMEType)
					this.formatType(mi.MIMEType);
				else if("type" in mi && mi.type)
					this.formatType(mi.type);
			}
		}

		try {
			_uri = this.checkFakeURINeeded(_uri);

			//var uri = Components.classes["@mozilla.org/network/standard-url;1"]
			//	.createInstance(Components.interfaces.nsIURI);
			//uri.spec = _uri;
			var uri = this.ios.newURI(_uri, null, null); //~ todo: specify charset ?
			var schm = uri.scheme && uri.scheme.toLowerCase();

			var ph = Components.interfaces.nsIProtocolHandler;
			if("URI_DOES_NOT_RETURN_DATA" in ph) { // Firefox 3+
				var flags = this.ios.getProtocolFlags(schm);
				if(flags & ph.URI_DOES_NOT_RETURN_DATA) {
					this.ut.warning('URI_DOES_NOT_RETURN_DATA (scheme: "' + schm + '")');
					this.requestFailed("noDataProtocol");
					this.onStopRequestCallback(false);
					return false;
				}
			}

			if(this.channel)
				this.channel.cancel(Components.results.NS_BINDING_ABORTED);
			this.cancelCheckChannelResumable();

			var ch = this.channel = this.newChannelFromURI(uri, bypassCache);
			ch.notificationCallbacks = this; // Detect redirects
			// => getInterface() => asyncOnChannelRedirect()

			if(ch instanceof Components.interfaces.nsIHttpChannel) {
				ch.requestMethod = requestMethod || "HEAD";
				this.headers.caption(this.ut.getLocalized("request"));
				this._requestSection = this.headers.beginSection();
				ch.visitRequestHeaders(this);
				this.headers.endSection();
			}

			try {
				ch.asyncOpen(this, null);
				this.requestHash = this.getRequestHash(ch);
				return this.activeRequest = true;
			}
			catch(e2) {
				Components.utils.reportError(e2);
				this.requestFailed("cantOpen");
			}
			this.onStopRequestCallback(false);
			return false;
		}
		catch(e) {
			this.headers.ensureSectionsEnded();
			Components.utils.reportError(e);
			this.requestFailed("badURI");
		}
		this.onStopRequestCallback(false);
		return false;
	},
	_errorTimer: 0,
	requestFailed: function(reason) {
		var root = document.documentElement;
		clearTimeout(this._errorTimer);
		root.setAttribute("linkPropsPlus_error", reason);
		this._errorTimer = setTimeout(function() {
			root.removeAttribute("linkPropsPlus_error");
		}, 700);
	},
	_fakeURIs: { __proto__: null },
	checkFakeURINeeded: function(uri) {
		// Ugly workaround...
		// Request will be sended after downloading file from "_uri" to %temp%.
		// Following works for me in some tests, but it is very bad hack.
		if(
			this.isDownloadDialog
			&& (this.fxVersion < 4 || this.pu.get("download.forceFakeURIHack")) //~ todo: test!
		) {
			uri += "?" + Math.random().toFixed(16).substr(2) + Math.random().toFixed(16).substr(2);
			this._fakeURIs[uri] = true;
		}
		return uri;
	},
	getRealURI: function(fakeURI) {
		if(fakeURI in this._fakeURIs)
			return fakeURI.replace(/\?\d+$/, "");
		return fakeURI;
	},
	newChannelFromURI: function(uri, bypassCache) {
		var ch = uri.scheme == "about" && "nsIAboutModule" in Components.interfaces
			? Components.classes["@mozilla.org/network/protocol/about;1?what=" + uri.path.replace(/[?&#].*$/, "")]
				.getService(Components.interfaces.nsIAboutModule)
				.newChannel(uri, null /* nsILoadInfo since Firefox 36 */)
			: this.ios.newChannelFromURI(uri);

		if(ch instanceof Components.interfaces.nsIRequest) try {
			ch.loadFlags |= ch.LOAD_BACKGROUND | ch.INHIBIT_CACHING;
			if(bypassCache)
				ch.loadFlags |= ch.LOAD_BYPASS_CACHE;
		}
		catch(e) {
			Components.utils.reportError(e);
		}

		if(
			"nsIPrivateBrowsingChannel" in Components.interfaces
			&& ch instanceof Components.interfaces.nsIPrivateBrowsingChannel
			&& "setPrivate" in ch
			&& this.isPrivate
		)
			ch.setPrivate(true);

		if(ch instanceof Components.interfaces.nsIHttpChannel) {
			var ref = this.isOwnWindow ? this.realReferer : this.referer;
			ref && ch.setRequestHeader("Referer", ref, false);
		}

		ch instanceof Components.interfaces.nsIFTPChannel;
		return ch;
	},
	getRequestHash: function(ch) {
		var hash = this.getRealURI(ch.originalURI.spec);
		if(ch instanceof Components.interfaces.nsIHttpChannel) try {
			hash += "\n" + ch.getRequestHeader("Referer");
		}
		catch(e) {
		}
		return hash;
	},

	// Autoclose feature
	_acTimeout: 0,
	_acProgressInterval: 0,
	autoCloseInitialized: false,
	autoCloseActive: false,
	initAutoClose: function() {
		if(!this.canAutoClose)
			return;
		if(!this.requestFinished && this.pu.get("autoClose.onlyAfterRequest"))
			return;

		if(this.autoCloseInitialized)
			return;
		this.autoCloseInitialized = true;

		var dur = this._acDelay = this.pu.get("autoClose.delay") || 0;
		if(dur < 1000 || !this.pu.get("autoClose.enabled"))
			return;
		this.delayedClose();
		if(this.pu.get("autoClose.dontCloseUnderCursor")) {
			this.setDontClose(true);
			// Note: works only if mouse was moved after window opening
			if(document.querySelector && document.querySelector(":hover"))
				this.windowOver();
		}
	},
	destroyAutoClose: function(restart) {
		if(!this.autoCloseInitialized)
			return;
		this.autoCloseInitialized = false;

		this.setDontClose(false);
		if(this.progressInitialized)
			this.progress.hidden = true;
		if(restart)
			this.cancelDelayedClose();
	},
	restartAutoClose: function() {
		if(!this.autoCloseActive)
			return;
		this.cancelDelayedClose();
		this.delayedClose();
	},
	reinitAutoClose: function() {
		this.destroyAutoClose(true);
		this.initAutoClose();
	},
	setDontClose: function(enable) {
		var action = enable ? window.addEventListener : window.removeEventListener;
		action.call(window, "mouseover", this, false);
		action.call(window, "mouseout",  this, false);
		action.call(window, "mousemove", this, false);
		action.call(window, "mouseup",   this, true);
		this._windowOver = false;
		document.documentElement.removeAttribute("lpp_hover");
	},
	_windowOver: false,
	windowOver: function() {
		if(this._windowOver)
			return;
		this._windowOver = true;
		document.documentElement.setAttribute("lpp_hover", "true");
		this.cancelDelayedClose();
	},
	windowOut: function() {
		if(!this._windowOver)
			return;
		this._windowOver = false;
		document.documentElement.setAttribute("lpp_hover", "false");
		this.delayedClose();
	},
	delayedClose: function() {
		this.autoCloseActive = true;
		this._acTimeout = setTimeout(window.close, this._acDelay);
		this._acStartTime = Date.now();
		var progress = this.progress;
		progress.value = 0;
		progress.hidden = false;
		progress.max = this._acPrecision = progress.boxObject.width * 4 || 500;
		var _this = this;
		this._acProgressInterval = setInterval(
			function() {
				_this.setProgress();
			},
			Math.round(this._acDelay/this._acPrecision) + 4
		);
	},
	cancelDelayedClose: function() {
		this.autoCloseActive = false;
		clearTimeout(this._acTimeout);
		clearInterval(this._acProgressInterval);
		this.progress.value = 0;
		//this.progress.hidden = true;
	},
	progressInitialized: false,
	get progress() {
		this.progressInitialized = true;
		var progressBlock = this.$("linkPropsPlus-autocloseProgressBlock");
		var root = document.documentElement;
		var cs = window.getComputedStyle(root, null); // May be null in closing window
		cs && progressBlock.setAttribute("chromedir", cs.direction);
		root.appendChild(progressBlock); // #linkPropsPlus-container can be hidden!
		var progress = this.$("linkPropsPlus-autocloseProgress");
		if(!("max" in progress)) { // Firefox 3.0 and older
			progress._gain = 1;
			progress.__defineGetter__("max", function() {
				return Math.round(this.getAttribute("max") * this._gain);
			});
			progress.__defineSetter__("max", function(max) {
				this._gain = max/100;
				this.setAttribute("max", 100);
			});
			progress.__defineGetter__("value", function() {
				return Math.round(this.getAttribute("value") * this._gain);
			});
			progress.__defineSetter__("value", function(value) {
				this.setAttribute("value", Math.round(value/this._gain));
			});
		}
		delete this.progress;
		return this.progress = progress;
	},
	setProgress: function() {
		var persent = (Date.now() - this._acStartTime)/this._acDelay;
		if(persent >= 1) {
			clearInterval(this._acProgressInterval);
			return;
		}
		this.progress.value = Math.round(this._acPrecision * persent);
	},

	_uri: null,
	get uri() {
		if(this.isOwnWindow)
			return this.$("linkPropsPlus-uri").value;
		if(this.isPropsDialog)
			return this.$("link-url-text").value;

		// Based on code of FlashGot extension https://addons.mozilla.org/addon/flashgot/
		// chrome://flashgot/content/flashgotDMOverlay.js
		return this._uri = dialog.mLauncher.source.spec;
	},
	get realReferer() {
		if(this.isPropsDialog)
			return window.arguments[0].ownerDocument.documentURI;
		if(this.isOwnWindow)
			return this.wnd.referer;
		var err;
		try {
			return dialog.mContext
				.QueryInterface(Components.interfaces.nsIWebNavigation)
				.currentURI.spec;
		}
		catch(e) {
			err = e;
		}
		var sourceDoc = this.sourceDocument;
		var ref = sourceDoc && sourceDoc.documentURI;
		if(ref)
			return ref;
		Components.utils.reportError(err);
		return this._uri;
	},
	get referer() {
		return this.ut.checkReferer(this.realReferer, this.uri);
	},
	get refererURI() {
		try {
			return this.ios.newURI(this.referer, null, null);
		}
		catch(e) {
		}
		return undefined;
	},
	get isHttp() {
		try {
			return /^https?:?$/i.test(
				this.ios.newURI(this.uri, null, null)
					.scheme
			);
		}
		catch(e) {
		}
		return false;
	},
	compareURIs: function(uri, uri2) {
		try {
			return this.ios.newURI(uri, null, null)
				.equals(this.ios.newURI(uri2, null, null));
		}
		catch(e) {
		}
		return uri == uri2;
	},
	get sourceDocument() {
		var win = this.sourceWindow;
		return win && win.document || null;
	},
	get sourceWindow() {
		return this.ensureWindowOpened(this._sourceWindow);
	},
	get _sourceWindow() {
		if(this.isPropsDialog)
			return window.arguments[0].ownerDocument.defaultView;
		if(this.isOwnWindow)
			return this.wnd.sourceWindow;

		// Based on code of FlashGot extension https://addons.mozilla.org/addon/flashgot/
		// chrome://flashgot/content/flashgotDMOverlay.js
		try {
			return dialog.mContext
				.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
				.getInterface(Components.interfaces.nsIDOMWindow);
		}
		catch(e) {
			Components.utils.reportError(e);
		}
		return top.opener && top.opener.content || null;
	},
	ensureWindowOpened: function(win) {
		try {
			if(win && !win.closed)
				return win;
		}
		catch(e) { // TypeError: can't access dead object
		}
		return null;
	},
	_isPrivate: false,
	get isPrivate() {
		if("_isPrivateOverrided" in this)
			return this._isPrivateOverrided;
		var sourceWindow = this.sourceWindow;
		if(!sourceWindow) // Already closed? Will use cached value
			return this._isPrivate;
		return this._isPrivate = this.ut.isWindowPrivate(sourceWindow);
	},

	_requestSection: null,
	headers: {
		parent: null,
		showDiff: false,
		init: function(parent) {
			this.parent = parent;
			// We should do this here to avoid strange bugs with window autosizing
			// after setRowHeight() in Firefox 3.6
			this.frame.setAttribute("transparent", "true");
			setTimeout(function(_this) {
				_this.createMenu();
				var cs = getComputedStyle(document.documentElement, null);
				var fs = _this.field.style;
				// For dark themes with non-system colors like NASA Night Launch
				fs.color = cs.color;
				// Note: in Firefox 3.6 we have wrong background only for empty frame
				if(_this.parent.fxVersion <= 3.6) // transparent="true" doesn't work
					fs.backgroundColor = cs.backgroundColor; // "-moz-Dialog"
			}, 0, this);
		},
		initStyles: function(field) {
			if(!field)
				field = this.field;
			function attr(name, add) {
				if(add)
					field.setAttribute(name, "true");
				else
					field.removeAttribute(name);
			}
			attr("hideCaptions",   !this.parent.pu.get("showCaptionsInHttpHeaders"));
			attr("hideTestResume", !this.parent.pu.get("testDownloadResumability.showHttpHeaders"));
			var showDiff = this.showDiff = this.parent.pu.get("showRequestHeadersDiff");
			attr("hideDiff", !showDiff);
			Array.forEach(
				field.getElementsByTagName("div"),
				function(node) {
					var cn = node.className;
					if(/(?:^|\s)entry(?:\s|$)/.test(cn)) {
						if(/(?:^|\s)changed(?:\s|$)/.test(cn))
							node.style.fontStyle = showDiff ? "italic" : "";
						if(/(?:^|\s)added(?:\s|$)/.test(cn))
							node.style.textDecoration = showDiff ? "underline" : "";
					}
				}
			);
		},
		destroy: function() {
			//this.clear();
			this._sections.length = 0;
			this._activeSection = null;
			this.parent = this.field = null;
		},
		get colon() {
			delete this.colon;
			return this.colon = this.parent.ut.getLocalized("colon").slice(1, -1) || ": ";
		},
		get frame() {
			delete this.frame;
			return this.frame = this.parent.$("linkPropsPlus-headers");
		},
		get field() {
			var field = this.frame.contentDocument.body
			this.initStyles(field);
			delete this.field;
			return this.field = field;
		},
		clear: function() {
			this._sections.length = 0;
			this._activeSection = null;
			this.field.textContent = "";
		},
		caption: function(s, nodeClass) {
			var h = this._node("h1", nodeClass || "caption", s);
			var twisty = document.createElement("button");
			twisty.className = "twisty";
			twisty.setAttribute("type", "disclosure");
			twisty.setAttribute("open", "true");
			h.insertBefore(twisty, h.firstChild);
			this._append(h);
			var prev = h.previousSibling;
			if(prev) {
				var spacerClass = (
					"spacer "
					+ (nodeClass || "").replace(/(?:^|\s+)caption(?:\s+|$)/, "")
				).replace(/ $/, "");
				this.spacer(h, spacerClass);
			}
		},
		spacer: function(insPos, nodeClass) {
			var spacer = this._node("div", nodeClass || "spacer");
			spacer.appendChild(this._node("br", "copyHack"));
			if(insPos)
				insPos.parentNode.insertBefore(spacer, insPos);
			else {
				var section = this._activeSection || this.field;
				section.appendChild(spacer);
			}
			return spacer;
		},
		entry: function(name, value) {
			var section = this.beginSection("entry");
			this._appendNode("strong", "name", name);
			this._appendNode("span", "colon", this.colon);
			this._appendNode("span", "value", value);
			this.endSection();
			return section;
		},
		getEntry: function(section, name) {
			var entries = section.getElementsByTagName("strong");
			for(var i = 0, l = entries.length; i < l; ++i) {
				var entry = entries[i];
				if(
					/(?:^|\s)name(?:\s|$)/.test(entry.className)
					&& entry.textContent == name
				)
					return entry.parentNode;
			}
			return null;
		},
		changeEntry: function(section, name, value) {
			// Note: we should use inline styles to copy/paste with formatting
			var oldEntry = this.getEntry(section, name);
			if(oldEntry) {
				var spans = oldEntry.getElementsByTagName("span");
				var valNode = spans[spans.length - 1];
				if(valNode.textContent == value)
					return;
				oldEntry.className += " replaced";
				//if(this.showDiff)
				oldEntry.style.textDecoration = "line-through";
				oldEntry.style.fontStyle = "italic";
				//oldEntry.style.display = "none";
			}
			var activeSection = this._activeSection;
			this._activeSection = section;
			var newSection = this.entry(name, value);
			this._activeSection = activeSection;
			newSection.className += " " + (oldEntry ? "changed" : "added");
			// Place new entry directly after old one
			if(oldEntry && newSection.previousSibling != oldEntry) { // Oh...
				var copyHack = newSection.previousSibling && newSection.previousSibling.lastChild;
				if(copyHack && copyHack.localName.toLowerCase() == "br")
					copyHack.parentNode.removeChild(copyHack);
				var insPos = oldEntry.nextSibling;
				oldEntry.parentNode.insertBefore(newSection, insPos);
				insPos && newSection.appendChild(this._node("br", "copyHack"));
			}
			if(this.showDiff) {
				if(oldEntry)
					newSection.style.fontStyle = "italic";
				else
					newSection.style.textDecoration = "underline";
			}
		},
		removeEntry: function(section, name) {
			// Note: we should use inline styles to copy/paste with formatting
			var entry = this.getEntry(section, name);
			if(!entry)
				return;
			entry.className += " removed";
			//if(this.showDiff)
			entry.style.textDecoration = "line-through";
			//entry.style.display = "none";
		},
		rawData: function(data) {
			// Note: here may be \0 symbol and we can't copy it
			var maxLen = 2e3;
			var huge = data.length > maxLen;
			var fragment = data.substr(0, maxLen);
			var raw = this._node("div", "rawData");
			fragment.split(/\r\n?|\n\r?/).forEach(function(data, i) {
				i && raw.appendChild(this._elt("br"));
				raw.appendChild(document.createTextNode(data));
			}, this);
			if(huge) {
				raw.appendChild(this._elt("br"));
				raw.appendChild(this._node("span", "rawDataLimit", "[\u2026]"));
			}
			this._append(raw);
		},
		_sections: [],
		_activeSection: null,
		beginSection: function(nodeClass) {
			var section = this._activeSection = this._appendNode("div", nodeClass || "block");
			this._sections.push(section);
			var prev = this._activeSection.previousSibling;
			if(prev && prev.className != "spacer")
				prev.appendChild(this._node("br", "copyHack"));
			return section;
		},
		endSection: function() {
			var sections = this._sections;
			sections.pop();
			this._activeSection = sections[sections.length - 1] || null;
		},
		ensureSectionsEnded: function() {
			while(this._activeSection)
				this.endSection();
		},
		_elt: function(nodeName) {
			return document.createElementNS("http://www.w3.org/1999/xhtml", nodeName);
		},
		_appendNode: function(nodeName, nodeClass, nodeText) {
			return this._append(this._node.apply(this, arguments));
		},
		_node: function(nodeName, nodeClass, nodeText) {
			var node = this._elt(nodeName);
			node.className = nodeClass;
			if(nodeText)
				node.appendChild(document.createTextNode(nodeText));
			return node;
		},
		_append: function(node) {
			var section = this._activeSection || this.field;
			return section.appendChild(node);
		},

		createMenu: function() {
			var dtd = "chrome://global/locale/textcontext.dtd";
			// Trick: fallback entities works fine, but only if all previous DTD files exists
			try {
				var xhr = new XMLHttpRequest();
				xhr.open("GET", dtd, true);
				xhr.overrideMimeType("text/plain"); // Prevent parsing errors
				xhr.onreadystatechange = function() {
					xhr.onreadystatechange = null;
					xhr.abort();
				};
				xhr.send(null);
			}
			catch(e) { // NS_ERROR_FILE_NOT_FOUND
				this.parent.ut.error(dtd + " not found, will use not localized context menu");
				Components.utils.reportError(e);
				dtd = "chrome://linkpropsplus/locale/linkPropsPlus.dtd";
			}
			var cm = new DOMParser().parseFromString(('\
				<!DOCTYPE menupopup [\n\
					<!ENTITY % textcontextDTD SYSTEM "' + dtd + '">\n\
					%textcontextDTD;\n\
					<!ENTITY copyCmd.label "Copy">\n\
					<!ENTITY copyCmd.accesskey "c">\n\
					<!ENTITY selectAllCmd.label "Select All">\n\
					<!ENTITY selectAllCmd.accesskey "a">\n\
				]>\n\
				<menupopup xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"\n\
					id="linkPropsPlus-headers-context"\n\
					onpopupshowing="linkPropsPlusSvc.headers.initMenu(this);"\n\
					oncommand="linkPropsPlusSvc.headers.doMenuCommand(event);">\n\
					<menuitem label="&copyCmd.label;" accesskey="&copyCmd.accesskey;" cmd="cmd_copy" />\n\
					<menuseparator />\n\
					<menuitem label="&selectAllCmd.label;" accesskey="&selectAllCmd.accesskey;" cmd="cmd_selectAll" />\n\
				</menupopup>').replace(/>\s+</g, "><"),
				"application/xml").documentElement;
			if(cm.localName == "menupopup")
				this.parent.$("linkPropsPlus-container").appendChild(cm);
		},
		initMenu: function(cm) {
			var frame = this.frame;
			var cd = document.commandDispatcher;
			if(cd.focusedWindow != frame.contentWindow)
				frame.contentWindow.focus();
			Array.forEach(cm.getElementsByTagName("menuitem"), function(mi) {
				var cmd = mi.getAttribute("cmd");
				if(cmd) {
					var controller = cd.getControllerForCommand(cmd);
					if(controller.isCommandEnabled(cmd))
						mi.removeAttribute("disabled");
					else
						mi.setAttribute("disabled", "true");
				}
			});
		},
		doMenuCommand: function(e) {
			var cmd = e.originalTarget.getAttribute("cmd");
			if(cmd) {
				var controller = document.commandDispatcher.getControllerForCommand(cmd);
				controller.doCommand(cmd);
				e.stopPropagation();
			}
		}
	},

	_headers: { __proto__: null },
	// nsIHttpHeaderVisitor
	visitHeader: function(header, value) {
		this.headers.entry(header, value);
		this._headers[header] = value;
		switch(header) {
			case "Content-Length": this.formatSize(value); break;
			case "Last-Modified":  this.formatDate(value); break;
			case "Content-Type":   this.formatType(value);
		}
	},

	formatSize: function(rawSize) {
		var textSize = this.getSizeStr(rawSize);
		if(!textSize)
			return;
		var target = this.$("linkPropsPlus-size");
		if(this._hasSize) {
			if(textSize != target.value) {
				this._lastSizeTip = rawSize;
				target.setAttribute("tooltiptext", textSize);
			}
		}
		else {
			this._hasSize = true;
			this._lastSize = rawSize;
			this.setMissingStyle(target, false);
			target.value = textSize;
			if(!this._hasSize)
				target.removeAttribute("tooltiptext");
		}
	},
	convertSize: function() {
		var target = this.$("linkPropsPlus-size");
		if(this._lastSize !== null)
			target.value = this.getSizeStr(this._lastSize);
		if(this._lastSizeTip !== null)
			target.setAttribute("tooltiptext", this.getSizeStr(this._lastSizeTip));
	},
	getSizeStr: function(rawSize) {
		var intSize = parseInt(rawSize);
		if(intSize < 0) // We get -1 for FTP directories
			return "";
		var size = this.formatNum(intSize, 0);

		var useBinaryPrefixes = this.pu.get("useBinaryPrefixes");
		var k = useBinaryPrefixes ? 1024 : 1000;
		var type, g;
		if     (intSize > k*k*k*k) type = "terabytes", g = k*k*k*k;
		else if(intSize > k*k*k)   type = "gigabytes", g = k*k*k;
		else if(intSize > k*k)     type = "megabytes", g = k*k;
		else if(intSize > k/2)     type = "kilobytes", g = k;

		if(type && useBinaryPrefixes)
			type = type.replace(/^(..)../, "$1bi");

		return type
			? this.ut.getLocalized(type, [this.formatNum(intSize/g), size])
			: this.ut.getLocalized("bytes", [size]);
	},
	get nativeLocaleNumbers() {
		var hasNative = false;
		try {
			(0).toLocaleString("invalid language");
		}
		catch(e) {
			hasNative = e.name == "RangeError"; // Firefox 29+
		}
		delete this.nativeLocaleNumbers;
		return this.nativeLocaleNumbers = hasNative;
	},
	initLocaleNumbers: function() {
		// Detect locale delimiter (e.g. 0.1 -> 0,1)
		if(/(\D+)\d+\D*$/.test((1.1).toLocaleString()))
			var ld = RegExp.$1;
		// Detect locale separator (e.g. 123456 -> 123 456 or 123,456)
		if(/^\D*\d+(\D+)/.test((1234567890123).toLocaleString()))
			var ls = RegExp.$1;
		delete this.localeDelimiter;
		delete this.localeSeparator;
		this.localeDelimiter = ld && ls ? ld : ".";
		this.localeSeparator = ld && ls ? ls : "\xa0";
	},
	get localeDelimiter() {
		this.initLocaleNumbers();
		return this.localeDelimiter;
	},
	get localeSeparator() {
		this.initLocaleNumbers();
		return this.localeSeparator;
	},
	formatNum: function(n, precision) {
		if(precision === undefined)
			precision = this.pu.get("sizePrecision") || 0;
		if(!this.nativeLocaleNumbers) {
			return this.formatNumStr(
				n.toFixed(precision)
					.replace(/\./, this.localeDelimiter)
			);
		}
		var locale = this.pu.get("localeNumbers") || undefined;
		if(locale == "<browser>")
			locale = navigator.language;
		try {
			return n.toLocaleString(locale, {
				minimumFractionDigits: precision,
				maximumFractionDigits: precision
			});
		}
		catch(e) {
			Components.utils.reportError(e);
		}
		return n.toLocaleString(); // Fallback for "invalid language tag" error
	},
	formatNumStr: function(s) {
		return s.replace(/(\d)(?=(?:\d{3})+(?:\D|$))/g, "$1" + this.localeSeparator); // 12345678 -> 12 345 678
	},
	formatDate: function(str) {
		if(!arguments.length)
			str = this._lastDate;
		else
			this._lastDate = str;
		var target = this.$("linkPropsPlus-lastModified");
		var date = new Date(str);
		var isInvalid = !str || !isFinite(date.getTime());
		this.setMissingStyle(target, isInvalid);
		if(str && isInvalid)
			target.tooltipText = str;
		var locale = this.pu.get("localeDates") || undefined;
		if(locale == "<browser>")
			locale = navigator.language;
		try {
			target.value = date.toLocaleString(locale);
		}
		catch(e) {
			Components.utils.reportError(e);
			target.value = date.toLocaleString(); // Fallback for "invalid language tag" error
		}
	},
	formatType: function(str) {
		var target = this.$("linkPropsPlus-contentType");
		if(this._hasType) {
			if(str != target.value)
				target.setAttribute("tooltiptext", str);
		}
		else {
			this._hasType = true;
			this.setMissingStyle(target, !str);
			target.value = str;
			target.removeAttribute("tooltiptext");
		}
	},
	formatStatus: function(status, statusText, canResumeDownload, isTested) {
		var tb = this.$("linkPropsPlus-status");
		tb.value = status + (statusText ? " " + statusText : "");
		this.setMissingStyle(tb, status >= 400 && status < 600);
		this.formatCanResumeDownload(canResumeDownload, isTested, tb);
	},
	formatCanResumeDownload: function(canResumeDownload, isTested, tb) {
		if(!tb)
			tb = this.$("linkPropsPlus-status");
		// We use clearResults() and may receive "tested" value before "non-tested"
		if(!isTested && tb.getAttribute("lpp_resumeDownloadTested") == "true")
			return;
		var grid = this.$("linkPropsPlus-grid"); // May be used in userChrome.css
		grid.setAttribute("lpp_canResumeDownload", canResumeDownload);
		grid.setAttribute("lpp_resumeDownloadTested", !!isTested);
		tb.setAttribute("lpp_canResumeDownload", canResumeDownload);
		tb.setAttribute("lpp_resumeDownloadTested", !!isTested);
		if(canResumeDownload == "probably")
			tb.tooltipText = this.ut.getLocalized("resumeDownloadMayBe");
		else if(canResumeDownload)
			tb.tooltipText = this.ut.getLocalized(isTested ? "resumeDownloadYes" : "resumeDownloadShouldBe");
		else
			tb.tooltipText = this.ut.getLocalized(isTested ? "resumeDownloadNo" : "resumeDownloadShouldNot");
	},
	formatURI: function(uri) {
		var tb = this.$("linkPropsPlus-directURI");
		uri = this.getRealURI(uri);
		if(arguments.length == 0)
			uri = tb.getAttribute("lpp_rawURI") || "";
		else
			tb.setAttribute("lpp_rawURI", uri);
		tb.value = this.ut.decodeURI(uri);
		var empty = !uri;
		tb.setAttribute("lpp_empty", empty);
		tb.parentNode.setAttribute("lpp_empty", empty);
		this.setMissingStyle(tb, this.compareURIs(uri, this.requestURI));

		var redirects = this.redirects;
		if(!redirects.length)
			tb.removeAttribute("tooltiptext");
		else {
			var header = this.ut.getLocalized("redirectsHeader", [redirects.length - 1]) + " \n";
			tb.tooltipText = header + redirects.map(function(redirect, i) {
				var uri = redirect.uri;
				if(i == 0) {
					uri = this.getRealURI(uri);
					return this.ut.decodeURI(uri);
				}
				var types = [];
				var flags = redirect.flags;
				var ces = Components.interfaces.nsIChannelEventSink;
				if(flags & ces.REDIRECT_TEMPORARY)
					types.push(this.ut.getLocalized("temporary"));
				if(flags & ces.REDIRECT_PERMANENT)
					types.push(this.ut.getLocalized("permanent"));
				if(flags & ces.REDIRECT_INTERNAL)
					types.push(this.ut.getLocalized("internal"));
				var type = types.join(this.ut.getLocalized("separator").slice(1, -1));
				return this.ut.getLocalized("redirectInfo", [type, this.ut.decodeURI(uri)]);
			}, this).join(" \n");
		}
	},

	fillInBlank: function() {
		var target = this.$("linkPropsPlus-size");
		var missing = this.ut.getLocalized("missing");
		if(!target.value) {
		/*
			try {
				this.channel.QueryInterface(Components.interfaces.nsICachingChannel);
				if(this.channel.isFromCache())
					alert(this.channel);
			} catch(e) { alert(e) }
		*/
			this.setMissingStatus(target, missing);
		}

		target = this.$("linkPropsPlus-contentType");
		if(!target.value)
			this.setMissingStatus(target, missing);

		target = this.$("linkPropsPlus-lastModified");
		if(!target.value)
			this.setMissingStatus(target, missing);

		target = this.$("linkPropsPlus-status");
		if(!target.value)
			this.setMissingStatus(target, missing);
	},
	setMissingStatus: function(target, text) {
		target.value = text;
		this.setMissingStyle(target, true);
	},
	setMissingStyle: function(target, isMissing) {
		target.setAttribute("lpp_missing", isMissing);
		target.parentNode.setAttribute("lpp_missing", isMissing);
	},

	Components: Components, // We can receive nsIChannel notifications after window will be closed
	// And in Firefox 3.6 and older garbage collector may already remove Components from scope
	// nsIStreamListener
	onDataAvailable: function(request, ctxt, input, offset, count) {
		var data = this.getStreamData(input, count);
		request.cancel(this.Components.results.NS_BINDING_ABORTED);
		if(window.closed)
			return;
		if(request.URI && request.URI.scheme == "data")
			return;
		this.realCount += count;
		this.headers.caption(this.ut.getLocalized("rawData"));
		this.headers.rawData(data);
	},
	getStreamData: function(inputStream, count) {
		try {
			var bInput = Components.classes["@mozilla.org/binaryinputstream;1"]
				.createInstance(Components.interfaces.nsIBinaryInputStream);
			bInput.setInputStream(inputStream);
			return bInput.readBytes(count);
		}
		catch(e) {
			Components.utils.reportError(e);
		}
		return "";
	},
	// nsIRequestObserver
	onStartRequest: function(request, ctxt) {
		var ch = this.channel;
		if(!ch)
			return; // Window is closed
		// Extract final request headers from _original_ channel ("http-on-modify-request" and so on)
		this.checkHeadersChanges(ch, this._requestSection, this._headers);
		try {
			if(request instanceof Components.interfaces.nsIHttpChannel) {
				var statusStr = request.responseStatus + " " + request.responseStatusText;
				this.headers.caption(this.ut.getLocalized("response"));
				this.headers.beginSection();
				this.headers.entry("Status", statusStr);
				var headers = this._headers = { __proto__: null };
				request.visitResponseHeaders(this);
				this.headers.endSection();
				if(
					"X-Archive-Orig-Last-Modified" in headers // Used on http://archive.org/
					&& !("Last-Modified" in headers) // We prefer Last-Modified, if available
				)
					this.formatDate(headers["X-Archive-Orig-Last-Modified"]);
				var canResumeDownload = request instanceof Components.interfaces.nsIResumableChannel
					&& "Accept-Ranges" in headers
					&& headers["Accept-Ranges"] == "bytes"
					&& "Content-Length" in headers
					&& headers["Content-Length"] > 0;
				this.formatStatus(request.responseStatus, request.responseStatusText, canResumeDownload);
			}
			else {
				var canResumeDownload = request instanceof Components.interfaces.nsIResumableChannel
					? "probably"
					: false;
				var status = "responseStatus" in request && request.responseStatus || "";
				var statusText = "responseStatusText" in request && request.responseStatusText || "";
				this.formatStatus(status, statusText, canResumeDownload);
				if("contentType" in ch)
					this.formatType(ch.contentType);
				if("contentLength" in ch)
					this.formatSize(ch.contentLength);
				if("lastModifiedTime" in request && request.lastModifiedTime) { // Firefox 4+
					var t = request.lastModifiedTime;
					this.formatDate(t > 1e14 ? t/1000 : t);
				}
			}
		}
		catch(err) {
			this.headers.ensureSectionsEnded();
			this.ut.error("Can't get information from request");
			Components.utils.reportError(err);
		}
		finally {
			request.cancel(Components.results.NS_BINDING_ABORTED);
			this.fillInBlank();
			this.channel = null;
		}
	},
	onStopRequest: function(request, ctxt, status) {
		this.activeRequest = false;
		if(window.closed)
			return;
		if(!this.cancelling) {
			this.blockEscapeKey = true;
			clearTimeout(this.blockEscapeKeyTimer);
			this.blockEscapeKeyTimer = setTimeout(function(_this) {
				_this.blockEscapeKey = false;
			}, this.blockEscapeKeyDelay, this);
		}
		if(this.realCount > 0)
			this.formatSize(this.realCount.toString());
		if(request instanceof Components.interfaces.nsIChannel && request.URI)
			this.formatURI(request.URI.spec);
		//if(this.testResumability)
		//	this.checkChannelResumable(request);

		this.onStopRequestCallback(true);
	},
	checkHeadersChanges: function(ch, section, oldHeaders) {
		if(ch && section && oldHeaders && ch instanceof Components.interfaces.nsIHttpChannel) try {
			var newHeaders = { __proto__: null };
			ch.visitRequestHeaders({
				headers: this.headers,
				// nsIHttpHeaderVisitor
				visitHeader: function(header, value) {
					newHeaders[header] = value;
					this.headers.changeEntry(section, header, value);
				}
			});
			for(var header in oldHeaders)
				if(!(header in newHeaders))
					this.headers.removeEntry(section, header);
		}
		catch(e) {
			Components.utils.reportError(e);
		}
	},

	checkResumableChannel: null,
	checkChannelResumable: function(origChannel) {
		this.cancelCheckChannelResumable();
		if(origChannel) {
			if(!(origChannel instanceof Components.interfaces.nsIResumableChannel)) {
				this.formatCanResumeDownload(false, true);
				return;
			}
			var uri = origChannel.originalURI;
		}
		else {
			var _uri = this.checkFakeURINeeded(this.uri);
			var uri = this.ios.newURI(_uri, null, null);
		}
		var ch = this.newChannelFromURI(uri);
		if(!origChannel && this.getRequestHash(ch) != this.requestHash) {
			this.getHeaders({
				clear: true,
				forceTestResumability: true
			});
			return;
		}
		if(!(ch instanceof Components.interfaces.nsIResumableChannel)) {
			this.formatCanResumeDownload(false, true);
			return;
		}
		var testResume = this.$("linkPropsPlus-context-testDownloadResumability");
		testResume.disabled = true;
		this.checkResumableChannel = ch;
		if(ch instanceof Components.interfaces.nsIHttpChannel)
			ch.setRequestHeader("Range", "bytes=1-32", false);
		ch.resumeAt(1, "");
		var observer = {
			parent: this,
			done: false,
			get canceled() {
				return !this.parent.checkResumableChannel || window.closed;
			},
			setCanResumeDownload: function(canResumeDownload) {
				if(this.done || this.canceled)
					return;
				this.done = true;
				this.parent.formatCanResumeDownload(canResumeDownload, true);
			},
			// nsIStreamListener
			onDataAvailable: function(request, ctxt, input, offset, count) {
				var data = this.parent.getStreamData(input, count);
				request.cancel(this.parent.Components.results.NS_BINDING_ABORTED);
				this.setCanResumeDownload(!!data);
			},
			// nsIRequestObserver
			onStartRequest: function(request, ctxt) {
				this.parent.checkHeadersChanges(ch, requestSection, this._headers);
			},
			onStopRequest: function(request, ctxt, status) {
				if(!this.canceled && request instanceof Components.interfaces.nsIHttpChannel) try {
					var headers = this.parent.headers;
					var statusStr = request.responseStatus + " " + request.responseStatusText;
					headers.caption(this.parent.ut.getLocalized("testResumabilityResponse"), "caption testResume");
					headers.beginSection("block testResume");
					headers.entry("Status", statusStr);
					request.visitResponseHeaders(this);
					headers.endSection();
				}
				catch(e) {
					headers.ensureSectionsEnded();
					Components.utils.reportError(e);
				}
				this.setCanResumeDownload(false);
				this.parent.checkResumableChannel = null;
				setTimeout(function() {
					testResume.disabled = false;
				}, 200);
			},
			_headers: { __proto__: null },
			// nsIHttpHeaderVisitor
			visitHeader: function(header, value) {
				this.parent.headers.entry(header, value);
				this._headers[header] = value;
			}
		};
		if(ch instanceof Components.interfaces.nsIHttpChannel) try {
			this.headers.caption(this.ut.getLocalized("testResumabilityRequest"), "caption testResume");
			var requestSection = this.headers.beginSection("block testResume");
			ch.visitRequestHeaders(observer);
			this.headers.endSection();
		}
		catch(e) {
			this.headers.ensureSectionsEnded();
			Components.utils.reportError(e);
		}
		ch.asyncOpen(observer, null);
	},
	cancelCheckChannelResumable: function() {
		var crCh = this.checkResumableChannel;
		if(crCh) {
			this.checkResumableChannel = null;
			crCh.cancel(Components.results.NS_BINDING_ABORTED);
		}
	},
	onStopRequestCallback: function(ok) {
		this.requestFinished = true;
		if(this.isOwnWindow)
			this.wnd.onStopRequest(ok);
		this.sendGetItem.disabled = /*this.activeRequest ||*/ !this.isHttp;
		this.initAutoClose();
	},

	// nsIInterfaceRequestor
	getInterface: function(iid) {
		if(
			iid.equals(Components.interfaces.nsIChannelEventSink)
			|| iid.equals(Components.interfaces.nsILoadContext) // Hack for Private Tab extension
				&& "@mozilla.org/network/protocol;1?name=private" in Components.classes
				&& new Error().stack.indexOf("@chrome://privatetab/content/protocol.js:") != -1
		)
			return this;
		throw Components.results.NS_ERROR_NO_INTERFACE;
	},
	// nsIChannelEventSink
	onChannelRedirect: function(oldChannel, newChannel, flags) { // Gecko < 2
		this.onRedirect.apply(this, arguments);
	},
	asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback) {
		callback.onRedirectVerifyCallback(Components.results.NS_OK); // Allow redirect
		this.onRedirect.apply(this, arguments);
	},
	onRedirect: function(oldChannel, newChannel, flags) {
		var redirects = this.redirects;
		if(!redirects.length)
			redirects.push({ uri: oldChannel.URI.spec });
		redirects.push({ uri: newChannel.URI.spec, flags: flags });
	},
	// nsILoadContext (fake, only for Private Tab extension)
	get usePrivateBrowsing() {
		return this.isPrivate;
	},
	set usePrivateBrowsing(isPrivate) {
		this._isPrivateOverrided = isPrivate;
		if(this.isOwnWindow)
			this.wnd.setTitle();
	},

	cancelling: false,
	cancellingTimer: 0,
	cancel: function() {
		var ch = this.channel;
		if(ch && this.activeRequest) {
			this.channel = null;

			// Allow press Escape twice to cancel request and close window
			this.cancelling = true;
			clearTimeout(this.cancellingTimer);
			this.cancellingTimer = setTimeout(function(_this) {
				_this.cancelling = false;
			}, this.blockEscapeKeyDelay, this);

			ch.cancel(Components.results.NS_BINDING_ABORTED);
			this.fillInBlank();
			//if(this.channel instanceof Components.interfaces.nsIFTPChannel)
			this.onStopRequest(ch);
			return true;
		}
		this.cancelCheckChannelResumable();
		return false;
	}
};
linkPropsPlusSvc.instantInit();