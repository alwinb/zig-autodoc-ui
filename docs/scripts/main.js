const { markdown, escapeHtml } = MarkdownModule
const { Autodoc } = AutodocModule
const { assign } = Object
const log = console.log.bind (console)


// View 'framework' 
// ----------------

// OK trying my own view stuff.
// Its a small renderer combinator library;

// A renderer is a function render (model, domnode) --- where domnode may be undefined.
// It is expected to update the domnode to show the model data,
// If domnode is undefined, it is expected to create a new one and return it.

// DOM helpers

function h (tag, ...subs) {
  const tags = tag.split ('.')
  const el = document.createElement (tags[0])
  el.classList.add (...tags.slice (1))
  el.append (...subs)
  return el
}

// domNodeById returns a plain js object as a dict,
// that maps id => DOM node.

function domNodesById (ids) {
  const dict = {}
  for (const id of ids)
    dict[id] = document.getElementById (id)
  return dict
}

function hide (...elems) {
  for (const e of elems) e.classList.add ("hidden")
}

// Render / Update functions and combinators:

// Sequence - renders a container element with a sequence of subitems.
function SequenceRenderer (renderItem, containerTagName = 'div') {
  return function renderSequence (content, elem = h(containerTagName)) {
    const cs = it (content), len = elem.childNodes.length
    let i = 0, c = cs.next ()
    for (; !c.done && i < len; i++) { // update existing items
      renderItem (c.value, elem.childNodes[i])
      c = cs.next ()
    }
    for (; !c.done; i++) { // add new nodes if needed
      elem.appendChild (renderItem (c.value, undefined))
      c = cs.next ()
    }
    while (i < elem.childNodes.length) { // remove excess nodes
      elem.lastChild.remove ()
    }
  }
}

// Supports the use of iterators so as to enable lazy analysis of model data
function* it (input) {
  for (const x of input) yield x
}

// A List is like a Sequence but it wraps its subviews inside <li> elements
function ListRenderer (renderSubView, tagname = 'ul') {
  return SequenceRenderer (WrapRenderer (renderSubView, 'li'), tagname)
}

// Now THIS might be called a Wrapper ;D
function WrapRenderer (renderSubview, tagname = 'li') {
  return function (content, el = h(tagname)) {
    if (el.firstChild) renderSubview (content, el.firstChild)
    else el.append (renderSubview (content))
    return el
  }
}

// Render a link
function renderUpdateLink ({ href, title, active }, el = h('a')) {
  el.setAttribute ('href', href)
  el.textContent = title
  if (active) el.classList.add ('active')
  else el.classList.remove ('active')
  return el
}


// UI State (NavigationState)
// --------------------

const NAV_MODES = {
  API: "#A;",
  API_INTERNAL: "#a;",
  GUIDES: "#G;",
};

function NavigationState (rootPkg, guides) {

  const self = this

  this.nav = {
    mode: NAV_MODES.API,
    activeGuide: "",
    // each element is a package name, e.g. @import("a") then within there @import("b")
    // starting implicitly from root package
    pkgNames: [],
    // same as above except actual packages, not names
    pkgObjs: [],
    // Each element is a decl name, `a.b.c`, a is 0, b is 1, c is 2, etc.
    // empty array means refers to the package itself
    declNames: [],
    // these will be all types, except the last one may be a type or a decl
    declObjs: [],
    // (a, b, c, d) comptime call; result is the value the docs refer to
    callName: null,
  };
  this.searchText = "";
  this.searchIndex = -1;
  this.feelingLucky = false;

  // Methods/ API
  assign (self, {updateNav, toLocationHash })


  // Implementation

  function toLocationHash () {
    let base = nav.mode;

    if (nav.pkgNames.length === 0 && nav.declNames.length === 0)
      return base;

    else if (declNames.length === 0 && nav.callName == null)
      return base + nav.pkgNames.join(".");

    else if (callName == null)
      return base + nav.pkgNames.join(".") + ":" + nav.declNames.join(".");

    else base +
      nav.pkgNames.join(".") + ":" + nav.declNames.join(".") + ";" + nav.callName
  }

  function updateNav (hashString) {

    // OK so this parses the location string
    // (which is coded in the hash)
    // but it does not also do the lookup yet

    this.nav = {
      mode: NAV_MODES.API, pkgNames: [], pkgObjs: [], declNames: [], declObjs: [], callName: null,
    };

    this.searchText = "";

    const mode = hashString.substring(0, 3);
    let rest = hashString.substring(3);

    const DEFAULT_HASH =
      NAV_MODES.API + rootPkg.name;

    switch (mode) {
      case NAV_MODES.API:
      case NAV_MODES.API_INTERNAL:
        // #A;PACKAGE:decl.decl.decl?search-term
        this.nav.mode = mode;

        let qpos = rest.indexOf("?");

        let nonSearchPart;
        if (qpos === -1) nonSearchPart = rest;
        else {
          nonSearchPart = rest.substring(0, qpos);
          this.searchText = decodeURIComponent(rest.substring(qpos + 1));
        }

        let parts = nonSearchPart.split(":");

        if (parts[0] == "")
          location.hash = DEFAULT_HASH;
        else
          this.nav.pkgNames = decodeURIComponent(parts[0]).split(".");

        if (parts[1] != null)
          this.nav.declNames = decodeURIComponent(parts[1]).split(".");
        return;

      case NAV_MODES.GUIDES:
        const guides_ = Object.keys(guides); // FIXME
        if (guides_.length != 0 && rest == "") {
          location.hash = NAV_MODES.GUIDES + guides_[0];
          return;
        }

        this.nav.mode = mode;
        this.nav.activeGuide = rest;
        return;

      default:
        location.hash = DEFAULT_HASH;
        return;
    }
  }

  function selectMode (nav_mode) {
    if (!(nav_mode in NAV_MODES) || nav_mode == this.nav.mode) return // ignore
    // TODO pull-in the toggle-mode from below
  }

}


// Main
// ----

function main () {

  // Config
  const searchTrimResultsMaxItems = 200;

  // Autodoc Database
  const autodoc = new Autodoc (zigAnalysis);
  const rootIsStd = autodoc.detectRootIsStd (); // cache

  // Viewmodel / UI state
  const uistate = new NavigationState (autodoc.getRootPackage(), autodoc.guides);

  let searchTimer = null;
  let searchTrimResults = true; // false after clicking 'show all results'
  let selectedSearchEntry;

  // DOM elements
  const dom = domNodesById ([
"sectTitle", "typeKind", "status", "sectNav", "listNav", "apiSwitch", "guideSwitch", "guidesMenu", "apiMenu",
"guidesList", "sectMainPkg", "sectPkgs", "listPkgs", "sectTypes", "listTypes", "sectTests",
"listTests", "sectDocTests", "docTestsCode", "sectNamespaces", "listNamespaces",
"sectErrSets", "listErrSets", "sectFns", "listFns", "sectFields", "listFields",
"sectGlobalVars", "listGlobalVars", "sectValues", "listValues", "fnProto", "fnProtoCode",
"fnSourceLink", "sectParams", "listParams", "tldDocs", "sectFnErrors", "listFnErrors",
"tableFnErrors", "fnErrorsAnyError", "fnExamples", "fnNoExamples", "declNoRef", "search",
"sectSearchResults", "sectSearchAllResultsLink", "docs", "guides", "listSearchResults",
"sectSearchNoResults", "sectInfo", "privDeclsBox", "tdZigVer", "hdrName", "helpModalWrapper",
"searchPlaceholder", "langRefLink", /* "tdTarget", "listFnExamples", */
  ])
  
  return init ();

  // init

  function init () {
    dom.search.addEventListener ("keydown", onSearchKeyDown);
    dom.search.addEventListener ("focus", ev => hide (dom.searchPlaceholder));
    dom.search.addEventListener ("blur", ev => {
      if (dom.search.value.length == 0)
        dom.searchPlaceholder.classList.remove("hidden");
    });
    dom.sectSearchAllResultsLink.addEventListener ('click', onClickSearchShowAllResults);
    dom.search.disabled = false;

    dom.privDeclsBox.addEventListener('change', toggleInternalDocMode)

    // make the modal disappear if you click outside it // FIXME
    dom.helpModalWrapper.addEventListener("click", ev => {
      if (ev.target.id == "helpModalWrapper")
        hide (dom.helpModalWrapper)
    });

    window.addEventListener("hashchange", onHashChange, false);
    window.addEventListener("keydown", onWindowKeyDown, false);

    if (location.hash == "") {
      location.hash = "#A;";
    }
    renderLangRefVersion ();
    onHashChange ();
  }


  // Render

  function render() {
    switch (uistate.nav.mode) {
      case NAV_MODES.API:
      case NAV_MODES.API_INTERNAL:
        return renderApi();
      case NAV_MODES.GUIDES:
        return renderGuides();
      default:
        throw "?";
    }
  }

  function renderGuides() {
    renderWindowTitle();

    // set guide mode
    dom.guideSwitch.classList.add("active");
    dom.apiSwitch.classList.remove("active");
    dom.guides.classList.remove ("hidden");
    hide (dom.docs, dom.apiMenu);

    // sidebar guides list
    const guidesLinks = Object.keys (autodoc.guides)
      .map (key => ({ href:NAV_MODES.GUIDES + key, title:key, active:key === uistate.nav.activeGuide }));
    ListRenderer (renderUpdateLink) (guidesLinks, dom.guidesList)

    if (guidesLinks.length > 0) {
      dom.guidesMenu.classList.remove ("hidden");
    }

    // main content
    const activeGuide = autodoc.guides[uistate.nav.activeGuide];
    if (activeGuide == undefined) {
      const root_file_idx = autodoc.getRootPackage().file;
      const root_file_name = autodoc.files[root_file_idx];
      dom.guides.innerHTML = markdown(`
          # Zig Guides
          These autodocs don't contain any guide.

          While the API section is a reference guide autogenerated from Zig source code,
          guides are meant to be handwritten explanations that provide for example:

          - how-to explanations for common use-cases
          - technical documentation
          - information about advanced usage patterns

          You can add guides by specifying which markdown files to include
          in the top level doc comment of your root file, like so:

          (At the top of \`${root_file_name}\`)
          \`\`\`
          //!zig-autodoc-guide: intro.md
          //!zig-autodoc-guide: quickstart.md
          //!zig-autodoc-guide: ../advanced-docs/advanced-stuff.md
          \`\`\`

          **Note that this feature is still under heavy development so expect bugs**
          **and missing features!**

          Happy writing!
        `);
    } else {
      dom.guides.innerHTML = markdown (activeGuide);
    }
  }

  function renderApi() {
    // set Api mode
    dom.apiSwitch.classList.add("active");
    dom.guideSwitch.classList.remove("active");
    dom.docs.classList.remove("hidden");
    dom.apiMenu.classList.remove("hidden");

    hide (
      dom.guides, dom.guidesMenu, dom.status, dom.fnProto, dom.sectParams, dom.tldDocs,
      dom.sectMainPkg, dom.sectTypes, dom.sectTests, dom.sectDocTests,
      dom.sectNamespaces, dom.sectErrSets, dom.sectFns, dom.sectFields,
      dom.sectSearchResults, dom.sectSearchAllResultsLink, dom.sectSearchNoResults,
      dom.sectInfo, dom.hdrName, dom.sectFnErrors, dom.fnExamples,
      dom.fnNoExamples, dom.declNoRef, dom.fnErrorsAnyError, dom.tableFnErrors,
      dom.sectGlobalVars, dom.sectValues);

    dom.privDeclsBox.checked = uistate.nav.mode == NAV_MODES.API_INTERNAL;

    // Analyse model

    const rootPkg = autodoc.getRootPackage();
    let pkg = rootPkg;

    // Collect list of all packages
    const packageList = autodoc.getPackageList (rootPkg)
    packageList.sort ((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase()
      return an < bn ? -1 : an > bn ? 1 : 0
    });
    packageList.unshift (rootPkg)

    // looks like this resolves the namepath to a package/ decl list
    
    uistate.nav.pkgObjs = [pkg];
    for (let i = 1; i < uistate.nav.pkgNames.length; i += 1) {
      let childPkg = autodoc.getPackage(pkg.table[uistate.nav.pkgNames[i]]);
      if (childPkg == null) return render404();
      pkg = childPkg;
      uistate.nav.pkgObjs.push(pkg);
    }

    let currentType = autodoc.getType(pkg.main);
    uistate.nav.declObjs = [currentType];
    for (let i = 0; i < uistate.nav.declNames.length; i += 1) {
      let childDecl = autodoc.findSubDecl(currentType, uistate.nav.declNames[i]);
      if (childDecl == null) return render404();
      let childDeclValue = autodoc.resolveValue(childDecl.value).expr;
      if ("type" in childDeclValue) {
        const t = autodoc.getType(childDeclValue.type);
        if (t.kind != autodoc.typeKinds.Fn) {
          childDecl = t;
        }
      }
      currentType = childDecl;
      uistate.nav.declObjs.push(currentType);
    }

    const declObject = uistate.nav.declObjs[uistate.nav.declObjs.length - 1];

    // Render

    renderWindowTitle();
    renderInfo();
    ListRenderer (renderUpdateLink) (packageLinks (packageList), dom.listPkgs) // Package list
    ListRenderer (renderUpdateLink) (navigationLinks (uistate.nav), dom.listNav) // Path

    if (uistate.searchText !== "")
      return renderSearch ();
    else 
      return renderApiPage (declObject)
  }

  // Detail view // Main Page

  function renderApiPage (decl) {
    let isDecl = autodoc.isDecl(decl);
    let isType = autodoc.isType(decl);

    const title = uistate.nav.declNames.length
      ? uistate.nav.declNames[uistate.nav.declNames.length-1]
      : uistate.nav.pkgNames[0] || '…'

    if (isDecl)
      renderDocTest(title, decl);

    if (autodoc.isContainerType(decl))
      return renderContainer(title, decl);

    if (!isDecl && !isType)
      return renderUnknownDecl(title, decl);

    if (isType)
      return renderType(decl);

    if (isDecl && decl.kind === "var")
      return renderVar(title, decl);

    if (isDecl && decl.kind === "const") {
      const value = autodoc.resolveValue(decl.value);
      if ("type" in value.expr) {
        let typeObj = autodoc.getType(value.expr.type);
        if (typeObj.kind === autodoc.typeKinds.Fn) {
          return renderFn (title, decl);
        }
      }
      return renderValue(title, decl);
    }
  }

  function renderSearch () {
    let ignoreCase = uistate.searchText.toLowerCase() === uistate.searchText;
    let matchedItems = autodoc.search (uistate.searchText, ignoreCase)

    if (matchedItems.length == 0)
      return dom.sectSearchNoResults.classList.remove("hidden");

    // else
    const searchTrimmed = searchTrimResults && matchedItems.length > searchTrimResultsMaxItems;
    const itemsLen = searchTrimmed ? searchTrimResultsMaxItems : matchedItems.length
    ListRenderer (renderUpdateLink) (searchResultLinks(matchedItems, itemsLen), dom.listSearchResults)

    if (searchTrimResults && searchTrimmed)
      dom.sectSearchAllResultsLink.classList.remove("hidden");
    else dom.sectSearchAllResultsLink.classList.add("hidden");

    renderSearchCursor();
    dom.sectSearchResults.classList.remove("hidden");
  }

  // A 'container type' is a type object with a typeKind being
  // one of Struct, Union, Enum, Opaque, or a generic type
  // (i.e. a function that retuns a container type)

  function renderContainer (title, container) {
    const containerNode = autodoc.getAstNode (container.src);

    if (container.src != null) {
      let docsSource = containerNode.docs;
      renderTldDocs (container.kind, title, docsSource);
    }

    // sectFields
    // div #sectTypes      > h2 "Types"            + ul                                  > li* > @typeDocs
    // div #sectGlobalVars > h2 "Global Variables" + div.table-container > table > tbody > @globalVarTr*
    // div #sectFns        > h2 "Functions"        + div > dl                            > @fnDi*
    // fiv #sectValues     > h2 "Values"           + div.table-container > table > tbody > @valueTr*
    // div #sectErrSets    > h2 "Error Sets"       + ul.hlist                            > li* > @errorSetItem
    // div #sectTests      > h2 "Tests"            + div.table-container > table > tbody > @testTr*
    // div #sectNamespaces > h2 "Namespaces"       + ul                                  > li* > @namespaceLink

    const { types, namespaces, errSets, fns, vars, vals, tests } =
      autodoc.getContainerInfo (container, { internalApiMode: uistate.nav.mode === NAV_MODES.API_INTERNAL })

    if (types.length !== 0) {
      ListRenderer (renderUpdateLink) (declLinks (types), dom.listTypes)
      dom.sectTypes.classList.remove ("hidden");
    }

    if (namespaces.length !== 0) {
      ListRenderer (renderUpdateLink) (declLinks (namespaces), dom.listNamespaces)
      dom.sectNamespaces.classList.remove ("hidden");
    }

    if (errSets.length !== 0) {
      ListRenderer (renderUpdateLink) (declLinks (errSets), dom.listErrSets)
      dom.sectErrSets.classList.remove ("hidden");
    }

    if (fns.length !== 0) {
      SequenceRenderer (renderUpdateFnDecl, 'dl') (fns, dom.listFns)
      dom.sectFns.classList.remove ("hidden");
    }

    if (containerNode.fields && containerNode.fields.length > 0) {
      SequenceRenderer (renderUpdateContainerField) (iterateContainerFields (container, containerNode), dom.listFields)
      dom.sectFields.classList.remove ("hidden");
    }

    if (vars.length !== 0) {
      SequenceRenderer (renderUpdateValueDeclTr, 'table') (vars, dom.listGlobalVars)
      dom.sectGlobalVars.classList.remove ("hidden");
    }

    if (vals.length !== 0) {
      SequenceRenderer (renderUpdateValueDeclTr, 'table') (vals, dom.listValues)
      dom.sectValues.classList.remove ("hidden");
    }

    if (tests.length !== 0) {
      SequenceRenderer (renderUpdateValueDeclTr, 'table') (tests, dom.listTests)
      dom.sectTests.classList.remove ("hidden");
    }
  }

  function renderErrorSet (errSetType) {
    if (errSetType.fields == null)
      return dom.fnErrorsAnyError.classList.remove("hidden");

    const errorList = autodoc.getErrorList (errSetType)
    SequenceRenderer (renderUpdateErrorSetItem) (errorList, dom.listFnErrors)
    dom.tableFnErrors.classList.remove("hidden");
    dom.sectFnErrors.classList.remove("hidden");
  }

  //

  function renderLangRefVersion () {
    let langRefVersion = autodoc.params.zigVersion;
    if (!/^\d+\.\d+\.\d+$/.test(langRefVersion)) {
      // the version is probably not released yet
      langRefVersion = "master";
    }
    dom.langRefLink.href = `https://ziglang.org/documentation/${langRefVersion}/`;
  }

  function renderWindowTitle() {
    const suffix = " - Zig";
    switch (uistate.nav.mode) {
      case NAV_MODES.API:
      case NAV_MODES.API_INTERNAL:
        let list = uistate.nav.pkgNames.concat(uistate.nav.declNames);
        if (list.length === 0)
          document.title = autodoc.getRootPackage().name + suffix;
        else
          document.title = list.join(".") + suffix;
      break;
      case NAV_MODES.GUIDES:
        document.title = "[G] " + uistate.nav.activeGuide + suffix;
      break;
    }
  }

  function renderDocTest (title, decl) {
    if (!decl.decltest) return;
    const astNode = autodoc.getAstNode(decl.decltest);
    dom.sectDocTests.classList.remove("hidden");
    dom.docTestsCode.innerHTML = astNode.code;
  }

  function renderUnknownDecl (title, decl) {
    dom.declNoRef.classList.remove ("hidden");
    let docs = autodoc.getAstNode (decl.src) .docs;
    log ('renderUnknownDecl', decl)
    renderTldDocs (0, title, docs); // REVIEW 0
  }

  function renderFn (title, fnDecl) {
    if ("refPath" in fnDecl.value.expr) {
      let last = fnDecl.value.expr.refPath.length - 1;
      let lastExpr = fnDecl.value.expr.refPath[last];
      console.assert("declRef" in lastExpr);
      fnDecl = autodoc.getDecl(lastExpr.declRef);
    }

    let value = autodoc.resolveValue(fnDecl.value);
    console.assert("type" in value.expr);
    let typeObj = autodoc.getType(value.expr.type);

    dom.fnProtoCode.innerHTML = exprName(value.expr, { wantHtml: true, wantLink: true, fnDecl });
    dom.fnSourceLink.innerHTML = "[<a target=\"_blank\" href=\"" + autodoc.sourceFileLink(fnDecl) + "\">src</a>]";

    let docsSource = null;
    let srcNode = autodoc.getAstNode(fnDecl.src);
    if (srcNode.docs != null) docsSource = srcNode.docs;

    renderFnParamDocs(fnDecl, typeObj);

    let retExpr = autodoc.resolveValue({ expr: typeObj.ret }).expr;
    if ("type" in retExpr) {
      let retIndex = retExpr.type;
      let errSetTypeIndex = null;
      let retType = autodoc.getType(retIndex);

      if (retType.kind === autodoc.typeKinds.ErrorSet)
        errSetTypeIndex = retIndex;
      else if (retType.kind === autodoc.typeKinds.ErrorUnion)
        errSetTypeIndex = retType.err.type;

      if (errSetTypeIndex != null) {
        let errSetType = autodoc.getType(errSetTypeIndex);
        renderErrorSet(errSetType);
      }
    }

    let protoSrcIndex = fnDecl.src;
    if (autodoc.typeIsGenericFn(value.expr.type)) {
      // does the generic_ret contain a container?
      var resolvedGenericRet = autodoc.resolveValue({ expr: typeObj.generic_ret });

      if ("call" in resolvedGenericRet.expr) {
        let call = autodoc.calls[resolvedGenericRet.expr.call];
        let resolvedFunc = autodoc.resolveValue({ expr: call.func });
        if (!("type" in resolvedFunc.expr)) return;
        let callee = autodoc.getType(resolvedFunc.expr.type);
        if (!callee.generic_ret) return;
        resolvedGenericRet = autodoc.resolveValue({ expr: callee.generic_ret });
      }

      // TODO: see if unwrapping the `as` here is a good idea or not.
      if ("as" in resolvedGenericRet.expr) {
        resolvedGenericRet = {
          expr: autodoc.exprs[resolvedGenericRet.expr.as.exprArg],
        };
      }

      if (!("type" in resolvedGenericRet.expr)) return;
      const genericType = autodoc.getType(resolvedGenericRet.expr.type);
      if (autodoc.isContainerType(genericType)) {
        renderContainer(title, genericType);
      }
    } else {
      dom.fnExamples.classList.add("hidden");
      dom.fnNoExamples.classList.add("hidden");
    }

    let protoSrcNode = autodoc.getAstNode(protoSrcIndex);
    if ( docsSource == null && protoSrcNode != null && protoSrcNode.docs != null ) {
      docsSource = protoSrcNode.docs;
    }

    const typeKind = autodoc.getType (fnDecl.value.expr.type) .kind // REVIEW
    renderTldDocs (typeKind, title, docsSource);
    dom.fnProto.classList.remove("hidden");
  }

  function renderTldDocs (kind, title, docsSource) {
    if (!docsSource)
      docsSource = `No top-level documentation is provided for **${title}**.`
    // TODO add a help out button
    dom.tldDocs.innerHTML = markdown(docsSource);
    dom.sectTitle.innerHTML = ""
    dom.typeKind.innerHTML = ""
    const h1 = document.createElement ('H1')
      h1.append (title)//, ' ', Autodoc.kindTagNames [kind])
    dom.sectTitle.insertBefore (h1, dom.sectTitle.firstChild)
    dom.typeKind.append (title, ' – ', Autodoc.kindTagNames [kind])
    dom.tldDocs.classList.remove("hidden");
  }

  function renderFnParamDocs (fnDecl, typeObj) {
    const fnNode = autodoc.getAstNode(fnDecl.src);
    // const isVarArgs = fnNode.varArgs; // REVIEW
    SequenceRenderer (renderUpdateFnParams) (iterateFnParams(fnNode, typeObj), dom.listParams)
    dom.sectParams.classList.remove("hidden");
  }

  function renderInfo () {
    dom.tdZigVer.textContent = autodoc.params.zigVersion;
    //dom.tdTarget.textContent = autodoc.params.builds[0].target;
    dom.sectInfo.classList.remove("hidden");
  }

  function render404 () {
    throw new Error ()
    dom.status.textContent = "404 Not Found";
    dom.status.classList.remove("hidden");
  }

  function renderType (typeObj) {
    const name = (rootIsStd && typeObj === autodoc.getType(autodoc.getRootPackage() .main))
      ? "std"
      : exprName({ type: typeObj }, { wantHtml: false, wantLink: false });
    if (name != null && name != "") {
      dom.hdrName.innerText =
        name + " (" + autodoc.typeKinds[typeObj.kind] + ")";
      dom.hdrName.classList.remove("hidden");
    }
    if (typeObj.kind == autodoc.typeKinds.ErrorSet)
      renderErrorSet(typeObj);
  }

  function renderValue (title, decl) {
    const docsSource = autodoc.getAstNode(decl.src).docs;
    log ('renderValue', decl)
    const typeKind = 0//autodoc.getType (decl.value.expression.type) .kind // REVIEW
    renderTldDocs (typeKind, title, docsSource)

    let resolvedValue = autodoc.resolveValue(decl.value);
    if (resolvedValue.expr.fieldRef) {
      const declRef = decl.value.expr.refPath[0].declRef;
      const type = autodoc.getDecl(declRef);
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">const</span> ' +
        escapeHtml(decl.name) +
        ": " +
        type.name +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    } else if (
      resolvedValue.expr.string !== undefined ||
      resolvedValue.expr.call !== undefined ||
      resolvedValue.expr.comptimeExpr
    ) {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">const</span> ' +
        escapeHtml(decl.name) +
        ": " +
        exprName(resolvedValue.expr, { wantHtml: true, wantLink: true }) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    } else if (resolvedValue.expr.compileError) {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">const</span> ' +
        escapeHtml(decl.name) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    } else {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">const</span> ' +
        escapeHtml(decl.name) +
        ": " +
        exprName(resolvedValue.typeRef, { wantHtml: true, wantLink: true }) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    }

  }

  function renderVar (title, decl) {
    const resolvedVar = autodoc.resolveValue(decl.value);
    const expr = resolvedVar.expr

    if (expr.fieldRef) {
      const declRef = decl.value.expr.refPath[0].declRef;
      const type = autodoc.getDecl(declRef);
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">var</span> ' +
        escapeHtml(decl.name) +
        ": " +
        type.name +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    }
    else if (expr.string != null || expr.call != null || expr.comptimeExpr) {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">var</span> ' +
        escapeHtml(decl.name) +
        ": " +
        exprName(expr, { wantHtml: true, wantLink: true }) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    }
    else if (expr.compileError) {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">var</span> ' +
        escapeHtml(decl.name) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    }
    else {
      dom.fnProtoCode.innerHTML =
        '<span class="tok-kw">var</span> ' +
        escapeHtml(decl.name) +
        ": " +
        exprName(resolvedVar.typeRef, { wantHtml: true, wantLink: true }) +
        " = " +
        exprName(decl.value.expr, { wantHtml: true, wantLink: true }) +
        ";";
    }

    const docsSource = autodoc.getAstNode (decl.src).docs;
    const typeKind = autodoc.getType (decl.value.typeRef.type) .kind // REVIEW
    renderTldDocs (typeKind, title, docsSource);
  }

  function walkResultTypeRef (wr) {
    if (wr.typeRef) return wr.typeRef;
    let resolved = autodoc.resolveValue(wr);
    if (wr === resolved) return { type: 0 };
    return walkResultTypeRef (resolved);
  }

  function exprName (expr, opts = { wantHtml:false, wantLink:false }) {
    // log ('render exprName', expr, opts)
    switch (Object.keys(expr)[0]) {
      default:
        return 'unknown'
        // throw "this expression is not implemented yet";
      case "bool":
        return expr.bool ? "true" : "false";

      case "&":
        return "&" + exprName(autodoc.exprs[expr["&"]], opts);

      case "compileError": {
        let compileError = expr.compileError;
        return "@compileError(" + exprName(autodoc.exprs[compileError], opts) + ")";
      }

      case "enumLiteral": {
        let literal = expr.enumLiteral;
        return "." + literal;
      }

      case "void":
        return "void";

      case "slice": {
        let payloadHtml = "";
        const lhsExpr = autodoc.exprs[expr.slice.lhs];
        const startExpr = autodoc.exprs[expr.slice.start];
        let decl = exprName(lhsExpr, opts);
        let start = exprName(startExpr, opts);
        let end = "";
        let sentinel = "";
        if (expr.slice["end"]) {
          const endExpr = autodoc.exprs[expr.slice.end];
          let end_ = exprName(endExpr, opts);
          end += end_;
        }
        if (expr.slice["sentinel"]) {
          const sentinelExpr = autodoc.exprs[expr.slice.sentinel];
          let sentinel_ = exprName(sentinelExpr, opts);
          sentinel += " :" + sentinel_;
        }
        payloadHtml += decl + "[" + start + ".." + end + sentinel + "]";
        return payloadHtml;
      }

      case "sliceIndex": {
        const sliceIndex = autodoc.exprs[expr.sliceIndex];
        return exprName(sliceIndex, opts, opts);
      }

      case "cmpxchg": {
        const typeIndex = autodoc.exprs[expr.cmpxchg.type];
        const ptrIndex = autodoc.exprs[expr.cmpxchg.ptr];
        const expectedValueIndex =
          autodoc.exprs[expr.cmpxchg.expected_value];
        const newValueIndex = autodoc.exprs[expr.cmpxchg.new_value];
        const successOrderIndex = autodoc.exprs[expr.cmpxchg.success_order];
        const failureOrderIndex = autodoc.exprs[expr.cmpxchg.failure_order];

        const type = exprName(typeIndex, opts);
        const ptr = exprName(ptrIndex, opts);
        const expectedValue = exprName(expectedValueIndex, opts);
        const newValue = exprName(newValueIndex, opts);
        const successOrder = exprName(successOrderIndex, opts);
        const failureOrder = exprName(failureOrderIndex, opts);

        let fnName = "@";

        switch (expr.cmpxchg.name) {
          case "cmpxchg_strong": {
            fnName += "cmpxchgStrong";
            break;
          }
          case "cmpxchg_weak": {
            fnName += "cmpxchgWeak";
            break;
          }
          default: {
            console.log("There's only cmpxchg_strong and cmpxchg_weak");
          }
        }

        return (
          fnName +
          "(" +
          type +
          ", " +
          ptr +
          ", " +
          expectedValue +
          ", " +
          newValue +
          ", " +
          "." +
          successOrder +
          ", " +
          "." +
          failureOrder +
          ")"
        );
      }

      case "cmpxchgIndex": {
        const cmpxchgIndex = autodoc.exprs[expr.cmpxchgIndex];
        return exprName(cmpxchgIndex, opts);
      }

      case "switchOp": {
        let condExpr = autodoc.exprs[expr.switchOp.cond_index];
        let ast = autodoc.getAstNode(expr.switchOp.src);
        let file_name = expr.switchOp.file_name;
        let outer_decl_index = expr.switchOp.outer_decl;
        let outer_decl = autodoc.getType(outer_decl_index);
        let line = 0;
        // console.log(expr.switchOp)
        // console.log(outer_decl)
        while (outer_decl_index !== 0 && outer_decl.line_number > 0) {
          line += outer_decl.line_number;
          outer_decl_index = outer_decl.outer_decl;
          outer_decl = autodoc.getType(outer_decl_index);
          // console.log(outer_decl)
        }
        line += ast.line + 1;
        let payloadHtml = "";
        let cond = exprName(condExpr, opts);

        payloadHtml +=
          "</br>" +
          "node_name: " +
          ast.name +
          "</br>" +
          "file: " +
          file_name +
          "</br>" +
          "line: " +
          line +
          "</br>";
        payloadHtml +=
          "switch(" +
          cond +
          ") {" +
          '<a href="/src/' +
          file_name +
          "#L" +
          line +
          '">' +
          "..." +
          "</a>}";
        return payloadHtml;
      }
      case "switchIndex": {
        const switchIndex = autodoc.exprs[expr.switchIndex];
        return exprName(switchIndex, opts);
      }

      case "fieldRef": {
        const enumObj = exprName({ type: expr.fieldRef.type }, opts);
        const field =
          autodoc.getAstNode(enumObj.src).fields[expr.fieldRef.index];
        const name = autodoc.getAstNode(field).name;
        return name;
      }

      case "enumToInt": {
        const enumToInt = autodoc.exprs[expr.enumToInt];
        return "@enumToInt(" + exprName(enumToInt, opts) + ")";
      }

      case "bitSizeOf": {
        const bitSizeOf = autodoc.exprs[expr.bitSizeOf];
        return "@bitSizeOf(" + exprName(bitSizeOf, opts) + ")";
      }
      case "sizeOf": {
        const sizeOf = autodoc.exprs[expr.sizeOf];
        return "@sizeOf(" + exprName(sizeOf, opts) + ")";
      }
      case "builtinIndex": {
        const builtinIndex = autodoc.exprs[expr.builtinIndex];
        return exprName(builtinIndex, opts);
      }
      case "builtin": {
        const param_expr = autodoc.exprs[expr.builtin.param];
        let param = exprName(param_expr, opts);

        let payloadHtml = "@";
        switch (expr.builtin.name) {
          case "align_of":
            payloadHtml += "alignOf";
            break;

          case "bool_to_int":
            payloadHtml += "boolToInt";
            break;

          case "embed_file":
            payloadHtml += "embedFile";
            break;

          case "error_name":
            payloadHtml += "errorName";
            break;

          case "set_cold":
            payloadHtml += "setCold";
            break;

          case "set_runtime_safety":
            payloadHtml += "setRuntimeSafety";
            break;

          case "tag_name":
            payloadHtml += "tagName";
            break;

          case "reify":
            payloadHtml += "Type";
            break;

          case "type_name":
            payloadHtml += "typeName";
            break;

          case "frame_type":
            payloadHtml += "Frame";
            break;

          case "frame_size":
            payloadHtml += "frameSize";
            break;

          case "ptr_to_int":
            payloadHtml += "ptrToInt";
            break;

          case "error_to_int":
            payloadHtml += "errorToInt";
            break;

          case "int_to_error":
            payloadHtml += "intToError";
            break;

          case "bit_not":
            return "~" + param;

          case "clz":
            return "@clz(T" + ", " + param + ")";

          case "ctz":
            return "@ctz(T" + ", " + param + ")";

          case "pop_count":
            return "@popCount(T" + ", " + param + ")";

          case "byte_swap":
            return "@byteSwap(T" + ", " + param + ")";

          case "bit_reverse":
            return "@bitReverse(T" + ", " + param + ")";

          case "sin": case "cos": case "tan": case "exp":
          case "exp2": case "log": case "log2": case "log10":
          case "fabs": case "floor": case "ceil": case "trunc":
          case "round": case "sqrt": case "panic": case "max":
          case "min":
            payloadHtml += expr.builtin.name
          break;

          default:
            console.log("builtin function not handled yet or doesn't exist!");
        }
        return payloadHtml + "(" + param + ")";
      }
      case "builtinBinIndex": {
        const builtinBinIndex = autodoc.exprs[expr.builtinBinIndex];
        return exprName(builtinBinIndex, opts);
      }
      case "builtinBin": {
        const lhsOp = autodoc.exprs[expr.builtinBin.lhs];
        const rhsOp = autodoc.exprs[expr.builtinBin.rhs];
        let lhs = exprName(lhsOp, opts);
        let rhs = exprName(rhsOp, opts);
        const names = {
          align_cast:    "alignCast",
          bit_offset_of: "bitOffsetOf",
          bit_reverse:   "bitReverse",
          bitcast:       "bitCast",
          const_cast:    "constCast",
          div_exact:     "divExact",
          div_floor:     "divFloor",
          div_trunc:     "divTrunc",
          float_cast:    "floatCast",
          float_to_int:  "floatToInt",
          has_decl:      "hasDecl",
          has_field:     "hasField",
          int_cast:      "intCast",
          int_to_enum:   "intToEnum",
          int_to_float:  "intToFloat",
          int_to_ptr:    "intToPtr",
          mod:           "mod",
          mod_rem:       "rem",
          offset_of:     "offsetOf",
          ptr_cast:      "ptrCast",
          reduce:        "reduce",
          rem:           "rem",
          shl_exact:     "shlExact",
          shr_exact:     "shrExact",
          splat:         "splat",
          truncate:      "truncate",
          vector_type:   "Vector",
          volatile_cast: "volatileCast",
        }
        const payloadHtml = '@' + (names[expr.builtinBin.name] ?? '')
        return payloadHtml + "(" + lhs + ", " + rhs + ")";
      }
      case "binOpIndex": {
        const binOpIndex = autodoc.exprs[expr.binOpIndex];
        return exprName(binOpIndex, opts);
      }
      case "binOp": {
        const lhsOp = autodoc.exprs[expr.binOp.lhs];
        const rhsOp = autodoc.exprs[expr.binOp.rhs];
        let lhs = exprName(lhsOp, opts);
        let rhs = exprName(rhsOp, opts);

        const print_lhs = lhsOp["binOpIndex"] ?
          "(" + lhs + ")" : lhs;

        const print_rhs = rhsOp["binOpIndex"] ?
          "(" + rhs + ")" : rhs;

        const binOps = {
          add: "+", addwrap: "+%", add_sat: "+|",
          sub: "-", subwrap: "-%", sub_sat: "-|",
          mul: "*", mulwrap: "*%", mul_sat: "*|", div: "/",
          shl: "<<", shl_sat: "<<|", shr: ">>",
          bit_or: "|", bit_and: "&",
          array_cat: "++", array_mul: "**",
          cmp_eq: "==", cmp_neq: "!=",
          cmp_gt: ">", cmp_gte: ">=",
          cmp_lt: "<", cmp_lte: "<=",
        }

        const operator = binOps[expr.binOp.name]
         //  "operator not handled yet or doesn't exist!";

        return print_lhs + " " + operator + " " + print_rhs;
      }
      case "errorSets": {
        const errUnionObj = autodoc.getType(expr.errorSets);
        let lhs = exprName(errUnionObj.lhs, opts);
        let rhs = exprName(errUnionObj.rhs, opts);
        return lhs + " || " + rhs;
      }
      case "errorUnion": {
        const errUnionObj = autodoc.getType(expr.errorUnion);
        let lhs = exprName(errUnionObj.lhs, opts);
        let rhs = exprName(errUnionObj.rhs, opts);
        return lhs + "!" + rhs;
      }
      case "struct": {
        // const struct_name =
        //   autodoc.decls[expr.struct[0].val.typeRef.refPath[0].declRef].name;
        const struct_name = ".";
        let struct_body = "";
        struct_body += struct_name + "{ ";
        for (let i = 0; i < expr.struct.length; i++) {
          const fv = expr.struct[i];
          const field_name = fv.name;
          const field_value = exprName(fv.val.expr, opts);
          // TODO: commented out because it seems not needed. if it deals
          //       with a corner case, please add a comment when re-enabling it.
          // let field_value = exprArg[Object.keys(exprArg)[0]];
          // if (field_value instanceof Object) {
          //   value_field = exprName(value_field)
          //     autodoc.decls[value_field[0].val.typeRef.refPath[0].declRef]
          //       .name;
          // }
          struct_body += "." + field_name + " = " + field_value;
          if (i !== expr.struct.length - 1) {
            struct_body += ", ";
          } else {
            struct_body += " ";
          }
        }
        struct_body += "}";
        return struct_body;
      }

      case "typeOf_peer": {
        let payloadHtml = "@TypeOf(";
        for (let i = 0; i < expr.typeOf_peer.length; i++) {
          let elem = autodoc.exprs[expr.typeOf_peer[i]];
          payloadHtml += exprName(elem, { wantHtml: true, wantLink: true });
          if (i !== expr.typeOf_peer.length - 1) {
            payloadHtml += ", ";
          }
        }
        payloadHtml += ")";
        return payloadHtml;
      }
      case "alignOf": {
        const alignRefArg = autodoc.exprs[expr.alignOf];
        let payloadHtml =
          "@alignOf(" +
          exprName(alignRefArg, { wantHtml: true, wantLink: true }) +
          ")";
        return payloadHtml;
      }
      case "typeOf": {
        const typeRefArg = autodoc.exprs[expr.typeOf];
        let payloadHtml =
          "@TypeOf(" +
          exprName(typeRefArg, { wantHtml: true, wantLink: true }) +
          ")";
        return payloadHtml;
      }
      case "typeInfo": {
        const typeRefArg = autodoc.exprs[expr.typeInfo];
        return "@typeInfo(" +
          exprName(typeRefArg, { wantHtml: true, wantLink: true }) +
          ")";
      }
      case "null": {
        if (opts.wantHtml) {
          return '<span class="tok-null">null</span>';
        } else {
          return "null";
        }
      }
      case "array": {
        let payloadHtml = ".{";
        for (let i = 0; i < expr.array.length; i++) {
          if (i != 0) payloadHtml += ", ";
          let elem = autodoc.exprs[expr.array[i]];
          payloadHtml += exprName(elem, opts);
        }
        return payloadHtml + "}";
      }
      case "comptimeExpr": {
        return autodoc.comptimeExprs[expr.comptimeExpr].code;
      }
      case "call": {
        let call = autodoc.calls[expr.call];
        let payloadHtml = "";

        switch (Object.keys(call.func)[0]) {
          default:
            throw "TODO";
          case "declRef":
          case "refPath": {
            payloadHtml += exprName(call.func, opts);
            break;
          }
        }
        payloadHtml += "(";

        for (let i = 0; i < call.args.length; i++) {
          if (i != 0) payloadHtml += ", ";
          payloadHtml += exprName(call.args[i], opts);
        }

        payloadHtml += ")";
        return payloadHtml;
      }
      case "as": {
        // @Check : this should be done in backend because there are legit @as() calls
        // const typeRefArg = autodoc.exprs[expr.as.typeRefArg];
        const exprArg = autodoc.exprs[expr.as.exprArg];
        // return "@as(" + exprName(typeRefArg, opts) +
        //   ", " + exprName(exprArg, opts) + ")";
        return exprName(exprArg, opts);
      }
      case "declRef": {
        const name = autodoc.getDecl(expr.declRef).name;

        if (opts.wantHtml) {
          let payloadHtml = "";
          if (opts.wantLink) {
            payloadHtml += '<a href="' + autodoc.findDeclNavLink(uistate.nav, name) + '">';
          }
          payloadHtml +=
            '<span class="tok-kw">' +
            name +
            "</span>";
          if (opts.wantLink) payloadHtml += "</a>";
          return payloadHtml;
        } else {
          return name;
        }
      }
      case "refPath": {
        let firstComponent = expr.refPath[0];
        let name = exprName(firstComponent, opts);
        let url = undefined;
        if (opts.wantLink && "declRef" in firstComponent) {
          url = autodoc.findDeclNavLink(uistate.nav, autodoc.getDecl(firstComponent.declRef).name);
        }
        for (let i = 1; i < expr.refPath.length; i++) {
          let component = undefined;
          if ("string" in expr.refPath[i]) {
            component = expr.refPath[i].string;
          } else {
            component = exprName(expr.refPath[i], { ...opts, wantLink: false });
            if (opts.wantLink && "declRef" in expr.refPath[i]) {
              url += "." + autodoc.getDecl(expr.refPath[i].declRef).name;
              component = '<a href="' + url + '">' +
                component +
                "</a>";
            }
          }
          name += "." + component;
        }
        return name;
      }
      case "int":
        return "" + expr.int;

      case "float":
        return "" + expr.float.toFixed(2);

      case "float128":
        return "" + expr.float128.toFixed(2);

      case "undefined":
        return "undefined";

      case "string":
        return '"' + escapeHtml(expr.string) + '"';

      case "int_big":
        return (expr.int_big.negated ? "-" : "") + expr.int_big.value;

      case "anytype":
        return "anytype";

      case "this":
        return "@This()";


      case "type": {
        let name = "";

        let typeObj = expr.type;
        if (typeof typeObj === "number") typeObj = autodoc.getType(typeObj);
        switch (typeObj.kind) {
          default:
            throw "TODO";
          case autodoc.typeKinds.Struct: {
            let structObj = typeObj;
            let name = "";
            if (opts.wantHtml) {
              if (structObj.is_tuple) {
                name = "<span class='tok-kw'>tuple</span> { ";
              } else {
                name = "<span class='tok-kw'>struct</span> { ";
              }
            } else {
              if (structObj.is_tuple) {
                name = "tuple { ";
              } else {
                name = "struct { ";
              }
            }
            if (structObj.fields.length > 1 && opts.wantHtml) { name += "</br>"; }
            let indent = "";
            if (structObj.fields.length > 1 && opts.wantHtml) {
              indent = "&nbsp;&nbsp;&nbsp;&nbsp;"
            }
            if (opts.indent && structObj.fields.length > 1) {
              indent = opts.indent + indent;
            }
            let structNode = autodoc.getAstNode(structObj.src);
            let field_end = ",";
            if (structObj.fields.length > 1 && opts.wantHtml) {
              field_end += "</br>";
            } else {
              field_end += " ";
            }

            for (let i = 0; i < structObj.fields.length; i += 1) {
              let fieldNode = autodoc.getAstNode(structNode.fields[i]);
              let fieldName = fieldNode.name;
              let html = indent;
              if (!structObj.is_tuple) {
                html += escapeHtml(fieldName);
              }

              let fieldTypeExpr = structObj.fields[i];
              if (!structObj.is_tuple) {
                html += ": ";
              }

              html += exprName(fieldTypeExpr, { ...opts, indent: indent });

              html += field_end;

              name += html;
            }
            if (opts.indent && structObj.fields.length > 1) {
              name += opts.indent;
            }
            name += "}";
            return name;
          }
          case autodoc.typeKinds.Enum: {
            let enumObj = typeObj;
            let name = "";
            if (opts.wantHtml) {
              name = "<span class='tok-kw'>enum</span>";
            } else {
              name = "enum";
            }
            if (enumObj.tag) {
              name += " (" + exprName(enumObj.tag, opts) + ")";
            }
            name += " { ";
            let enumNode = autodoc.getAstNode(enumObj.src);
            let fields_len = enumNode.fields.length;
            if (enumObj.nonexhaustive) {
              fields_len += 1;
            }
            if (fields_len > 1 && opts.wantHtml) { name += "</br>"; }
            let indent = "";
            if (fields_len > 1) {
              if (opts.wantHtml) {
                indent = "&nbsp;&nbsp;&nbsp;&nbsp;";
              } else {
                indent = "    ";
              }
            }
            if (opts.indent) {
              indent = opts.indent + indent;
            }
            let field_end = ",";
            if (fields_len > 1 && opts.wantHtml) {
              field_end += "</br>";
            } else {
              field_end += " ";
            }
            for (let i = 0; i < enumNode.fields.length; i += 1) {
              let fieldNode = autodoc.getAstNode(enumNode.fields[i]);
              let fieldName = fieldNode.name;
              let html = indent + escapeHtml(fieldName);

              html += field_end;

              name += html;
            }
            if (enumObj.nonexhaustive) {
              name += indent + "_" + field_end;
            }
            if (opts.indent) {
              name += opts.indent;
            }
            name += "}";
            return name;
          }
          case autodoc.typeKinds.Union: {
            let unionObj = typeObj;
            let name = "";
            if (opts.wantHtml) {
              name = "<span class='tok-kw'>union</span>";
            } else {
              name = "union";
            }
            if (unionObj.auto_tag) {
              if (opts.wantHtml) {
                name += " (<span class='tok-kw'>enum</span>";
              } else {
                name += " (enum";
              }
              if (unionObj.tag) {
                name += "(" + exprName(unionObj.tag, opts) + "))";
              } else {
                name += ")";
              }
            } else if (unionObj.tag) {
              name += " (" + exprName(unionObj.tag, opts) + ")";
            }
            name += " { ";
            if (unionObj.fields.length > 1 && opts.wantHtml) {
              name += "</br>";
            }
            let indent = "";
            if (unionObj.fields.length > 1 && opts.wantHtml) {
              indent = "&nbsp;&nbsp;&nbsp;&nbsp;"
            }
            if (opts.indent) {
              indent = opts.indent + indent;
            }
            let unionNode = autodoc.getAstNode(unionObj.src);
            let field_end = ",";
            if (unionObj.fields.length > 1 && opts.wantHtml) {
              field_end += "</br>";
            } else {
              field_end += " ";
            }
            for (let i = 0; i < unionObj.fields.length; i += 1) {
              let fieldNode = autodoc.getAstNode(unionNode.fields[i]);
              let fieldName = fieldNode.name;
              let html = indent + escapeHtml(fieldName);

              let fieldTypeExpr = unionObj.fields[i];
              html += ": ";

              html += exprName(fieldTypeExpr, { ...opts, indent: indent });

              html += field_end;

              name += html;
            }
            if (opts.indent) {
              name += opts.indent;
            }
            name += "}";
            return name;
          }
          case autodoc.typeKinds.Opaque: {
            let opaqueObj = typeObj;
            return opaqueObj;
          }
          case autodoc.typeKinds.ComptimeExpr: {
            return "anyopaque";
          }
          case autodoc.typeKinds.Array: {
            let arrayObj = typeObj;
            let name = "[";
            let lenName = exprName(arrayObj.len, opts);
            let sentinel = arrayObj.sentinel
              ? ":" + exprName(arrayObj.sentinel, opts)
              : "";
            // let is_mutable = arrayObj.is_multable ? "const " : "";

            if (opts.wantHtml) {
              name +=
                '<span class="tok-number">' + lenName + sentinel + "</span>";
            } else {
              name += lenName + sentinel;
            }
            name += "]";
            // name += is_mutable;
            name += exprName(arrayObj.child, opts);
            return name;
          }
          case autodoc.typeKinds.Optional:
            return "?" + exprName(typeObj.child, opts);
          case autodoc.typeKinds.Pointer: {
            let ptrObj = typeObj;
            let sentinel = ptrObj.sentinel
              ? ":" + exprName(ptrObj.sentinel, opts)
              : "";
            let is_mutable = !ptrObj.is_mutable ? "const " : "";
            let name = "";
            switch (ptrObj.size) {
              default:
                console.log("TODO: implement unhandled pointer size case");
              case autodoc.pointerSizeEnum.One:
                name += "*";
                name += is_mutable;
                break;
              case autodoc.pointerSizeEnum.Many:
                name += "[*";
                name += sentinel;
                name += "]";
                name += is_mutable;
                break;
              case autodoc.pointerSizeEnum.Slice:
                if (ptrObj.is_ref) {
                  name += "*";
                }
                name += "[";
                name += sentinel;
                name += "]";
                name += is_mutable;
                break;
              case autodoc.pointerSizeEnum.C:
                name += "[*c";
                name += sentinel;
                name += "]";
                name += is_mutable;
                break;
            }
            // @check: after the major changes in arrays the consts are came from switch above
            // if (!ptrObj.is_mutable) {
            //     if (opts.wantHtml) {
            //         name += '<span class="tok-kw">const</span> ';
            //     } else {
            //         name += "const ";
            //     }
            // }
            if (ptrObj.is_allowzero) {
              name += "allowzero ";
            }
            if (ptrObj.is_volatile) {
              name += "volatile ";
            }
            if (ptrObj.has_addrspace) {
              name += "addrspace(";
              name += "." + "";
              name += ") ";
            }
            if (ptrObj.has_align) {
              let align = exprName(ptrObj.align, opts);
              if (opts.wantHtml) {
                name += '<span class="tok-kw">align</span>(';
              } else {
                name += "align(";
              }
              if (opts.wantHtml) {
                name += '<span class="tok-number">' + align + "</span>";
              } else {
                name += align;
              }
              if (ptrObj.hostIntBytes != null) {
                name += ":";
                if (opts.wantHtml) {
                  name +=
                    '<span class="tok-number">' +
                    ptrObj.bitOffsetInHost +
                    "</span>";
                } else {
                  name += ptrObj.bitOffsetInHost;
                }
                name += ":";
                if (opts.wantHtml) {
                  name +=
                    '<span class="tok-number">' +
                    ptrObj.hostIntBytes +
                    "</span>";
                } else {
                  name += ptrObj.hostIntBytes;
                }
              }
              name += ") ";
            }
            //name += typeValueName(ptrObj.child, wantHtml, wantSubLink, null);
            name += exprName(ptrObj.child, opts);
            return name;
          }
          case autodoc.typeKinds.Float: {
            let floatObj = typeObj;
            if (opts.wantHtml) {
              return '<span class="tok-type">' + floatObj.name + "</span>";
            } else {
              return floatObj.name;
            }
          }
          case autodoc.typeKinds.Int: {
            let intObj = typeObj;
            let name = intObj.name;
            if (opts.wantHtml) {
              return '<span class="tok-type">' + name + "</span>";
            } else {
              return name;
            }
          }
          case autodoc.typeKinds.ComptimeInt:
            if (opts.wantHtml) {
              return '<span class="tok-type">comptime_int</span>';
            } else {
              return "comptime_int";
            }
          case autodoc.typeKinds.ComptimeFloat:
            if (opts.wantHtml) {
              return '<span class="tok-type">comptime_float</span>';
            } else {
              return "comptime_float";
            }
          case autodoc.typeKinds.Type:
            if (opts.wantHtml) {
              return '<span class="tok-type">type</span>';
            } else {
              return "type";
            }
          case autodoc.typeKinds.Bool:
            if (opts.wantHtml) {
              return '<span class="tok-type">bool</span>';
            } else {
              return "bool";
            }
          case autodoc.typeKinds.Void:
            if (opts.wantHtml) {
              return '<span class="tok-type">void</span>';
            } else {
              return "void";
            }
          case autodoc.typeKinds.EnumLiteral:
            if (opts.wantHtml) {
              return '<span class="tok-type">(enum literal)</span>';
            } else {
              return "(enum literal)";
            }
          case autodoc.typeKinds.NoReturn:
            if (opts.wantHtml) {
              return '<span class="tok-type">noreturn</span>';
            } else {
              return "noreturn";
            }
          case autodoc.typeKinds.ErrorSet: {
            let errSetObj = typeObj;
            if (errSetObj.fields == null) {
              return '<span class="tok-type">anyerror</span>';
            } else if (errSetObj.fields.length == 0) {
              return "error{}";
            } else if (errSetObj.fields.length == 1) {
              return "error{" + errSetObj.fields[0].name + "}";
            } else {
              // throw "TODO";
              let html = "error{ " + errSetObj.fields[0].name;
              for (let i = 1; i < errSetObj.fields.length; i++) html += ", " + errSetObj.fields[i].name;
              html += " }";
              return html;
            }
          }

          case autodoc.typeKinds.ErrorUnion: {
            let errUnionObj = typeObj;
            let lhs = exprName(errUnionObj.lhs, opts);
            let rhs = exprName(errUnionObj.rhs, opts);
            return lhs + "!" + rhs;
          }
          case autodoc.typeKinds.InferredErrorUnion: {
            let errUnionObj = typeObj;
            let payload = exprName(errUnionObj.payload, opts);
            return "!" + payload;
          }
          case autodoc.typeKinds.Fn: {
            let fnObj = typeObj;
            let fnDecl = opts.fnDecl;
            let linkFnNameDecl = opts.linkFnNameDecl;
            opts.fnDecl = null;
            opts.linkFnNameDecl = null;
            let payloadHtml = "";
            if (opts.addParensIfFnSignature && fnObj.src == 0) {
              payloadHtml += "(";
            }
            if (opts.wantHtml) {
              if (fnObj.is_extern) {
                payloadHtml += "pub extern ";
              }
              if (fnObj.has_lib_name) {
                payloadHtml += '"' + fnObj.lib_name + '" ';
              }
              payloadHtml += '<span class="tok-kw">fn </span>';
              if (fnDecl) {
                payloadHtml += '<span class="tok-fn">';
                if (linkFnNameDecl) {
                  payloadHtml +=
                    '<a href="' + linkFnNameDecl + '">' +
                    escapeHtml(fnDecl.name) +
                    "</a>";
                } else {
                  payloadHtml += escapeHtml(fnDecl.name);
                }
                payloadHtml += "</span>";
              }
            } else {
              payloadHtml += "fn ";
            }
            payloadHtml += "(";
            if (fnObj.params) {
              let fields = null;
              let isVarArgs = false;
              if (fnObj.src != 0) {
                let fnNode = autodoc.getAstNode(fnObj.src);
                fields = fnNode.fields;
                isVarArgs = fnNode.varArgs;
              }

              for (let i = 0; i < fnObj.params.length; i += 1) {
                if (i != 0) {
                  payloadHtml += ", ";
                }

                if (opts.wantHtml) {
                  payloadHtml +=
                    "<span class='argBreaker'><br>&nbsp;&nbsp;&nbsp;&nbsp;</span>";
                }
                let value = fnObj.params[i];
                let paramValue = autodoc.resolveValue({ expr: value });

                if (fields != null) {
                  let paramNode = autodoc.getAstNode(fields[i]);

                  if (paramNode.varArgs) {
                    payloadHtml += "...";
                    continue;
                  }

                  if (paramNode.noalias) {
                    if (opts.wantHtml) {
                      payloadHtml += '<span class="tok-kw">noalias</span> ';
                    } else {
                      payloadHtml += "noalias ";
                    }
                  }

                  if (paramNode.comptime) {
                    if (opts.wantHtml) {
                      payloadHtml += '<span class="tok-kw">comptime</span> ';
                    } else {
                      payloadHtml += "comptime ";
                    }
                  }

                  let paramName = paramNode.name;
                  if (paramName != null) {
                    // skip if it matches the type name
                    if (!autodoc.shouldSkipParamName(paramValue, paramName)) {
                      payloadHtml += paramName + ": ";
                    }
                  }
                }

                if (isVarArgs && i === fnObj.params.length - 1) {
                  payloadHtml += "...";
                } else if ("alignOf" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("typeOf" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("typeOf_peer" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("declRef" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("call" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("refPath" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("type" in value) {
                  payloadHtml += exprName(value, opts);
                  //payloadHtml += '<span class="tok-kw">' + name + "</span>";
                } else if ("binOpIndex" in value) {
                  payloadHtml += exprName(value, opts);
                } else if ("comptimeExpr" in value) {
                  let comptimeExpr =
                    autodoc.comptimeExprs[value.comptimeExpr].code;
                  if (opts.wantHtml) {
                    payloadHtml +=
                      '<span class="tok-kw">' + comptimeExpr + "</span>";
                  } else {
                    payloadHtml += comptimeExpr;
                  }
                } else if (opts.wantHtml) {
                  payloadHtml += '<span class="tok-kw">anytype</span>';
                } else {
                  payloadHtml += "anytype";
                }
              }
            }

            if (opts.wantHtml) {
              payloadHtml += "<span class='argBreaker'>,<br></span>";
            }
            payloadHtml += ") ";

            if (fnObj.has_align) {
              let align = autodoc.exprs[fnObj.align];
              payloadHtml += "align(" + exprName(align, opts) + ") ";
            }
            if (fnObj.has_cc) {
              let cc = autodoc.exprs[fnObj.cc];
              if (cc) {
                payloadHtml += "callconv(." + cc.enumLiteral + ") ";
              }
            }

            if (fnObj.is_inferred_error) {
              payloadHtml += "!";
            }
            if (fnObj.ret != null) {
              payloadHtml += exprName(fnObj.ret, {
                ...opts,
                addParensIfFnSignature: true,
              });
            } else if (opts.wantHtml) {
              payloadHtml += '<span class="tok-kw">anytype</span>';
            } else {
              payloadHtml += "anytype";
            }

            if (opts.addParensIfFnSignature && fnObj.src == 0) {
              payloadHtml += ")";
            }
            return payloadHtml;
          }
          // if (wantHtml) {
          //     return escapeHtml(typeObj.name);
          // } else {
          //     return typeObj.name;
          // }
        }
      }
    }
  }

  // Render or update
  
  function renderUpdateFnDecl (decl, elem) {
    elem = elem ?? h('div',
      h('dt',
        h('pre.fnSignature'),
        h('div', h('a.fr', '[src]'))),
      h('dd'))

    const [sig, src] = elem.children[0].children
    const desc = elem.children[1];

    let declType = autodoc.resolveValue(decl.value);
    console.assert("type" in declType.expr);
    sig.innerHTML = exprName(declType.expr, { fnDecl: decl, wantHtml: true, wantLink: true, linkFnNameDecl: autodoc.navLinkDecl(uistate.nav, decl.name) });

    assign (src.children[0], { target:'_blank', href:autodoc.sourceFileLink(decl) })

    let docs = autodoc.getAstNode(decl.src).docs
    if (docs == null || docs.length == 0)
      docs = 'No documentation provided.\n';

    if (docs.length < 100) 
      desc.innerHTML = markdown (docs);

    else {
      let short, long, span
      const expand = h('div.expand', 
        span = h('span.button'),
        short = h('div.sum-less'),
        long = h('div.sum-more'))

      short.innerHTML = markdown (shortDesc(docs));
      long.innerHtml = markdown (docs);
      desc.innerHTML = ''
      desc.append (expand)
    }
    return elem
  }

  function renderUpdateFnParams ({ name, type, docs }, elem) {
    elem = elem ?? h('div', h('pre'), h('div.fieldDocs'))
    const [pre, docsDiv] = elem.children
    pre.textContent = name
    pre.append (': ', h('span.tok-kw'))
    pre.lastChild.innerHTML = exprName (type, { wantLink:true, wantHtml:true})
    docsDiv.innerHTML = markdown(docs)
    return elem
  }

  function renderUpdateValueDeclTr (decl, elem) {
    elem = elem ?? h('tr',h('td', h('a')), h('td'), h('td'))

    const [tdName, tdType, tdDesc] = elem.children
    const [tdNameA] = tdName.children

    tdNameA.href = autodoc.navLinkDecl(uistate.nav, decl.name);
    tdNameA.textContent = decl.name;
    tdType.innerHTML = exprName(walkResultTypeRef(decl.value), { wantHtml: true, wantLink: true });

    let docs = autodoc.getAstNode(decl.src).docs;
    if (docs != null) tdDesc.innerHTML = markdown(shortDesc(docs));
    else tdDesc.textContent = "";
    return elem
  }

  function renderUpdateContainerField ({ field, fieldType, container }, divDom = h('div')) {
    const { name, docs } = field
    let docsNonEmpty = docs != null && docs !== "";

    const pre = h('pre.scroll-item', name)
    if (docsNonEmpty) pre.classList.add ('fieldHasDocs')

    // REVIEW what is happening here exactly
    if (container.kind === autodoc.typeKinds.Enum) {
      log ('enum', container, field, fieldType)
      pre.insertAdjacentHTML("beforeend", ' = <span class="tok-number">' + name + "</span>");
    }

    else {
      if (container.kind !== autodoc.typeKinds.Struct || !container.is_tuple) pre.append (': ')
      pre.insertAdjacentHTML("beforeend", exprName(fieldType, { wantHtml: true, wantLink: true }));
      let tsn = autodoc.typeShorthandName(fieldType);
      if (tsn) pre.insertAdjacentHTML("beforeend", "<span> (" + tsn + ")</span>");
    }

    divDom.innerHTML = '';
    divDom.append (pre)
    if (docsNonEmpty) divDom.insertAdjacentHTML("beforeend", '<div class="fieldDocs">' + markdown(docs) + "</div>");
    return divDom;
  }

  function renderUpdateErrorSetItem ({ name, docs }, elem = h('di', h('dt'), h('dd'))) {
    const [dt, dd] = elem.children
    dt.textContent = name;
    if (docs != null) dd.innerHTML = markdown(docs);
    else dd.textContent = "";
    return elem
  }

  // Event handlers

  function onHashChange () {

    uistate.updateNav (location.hash);

    if (dom.search.value !== uistate.searchText) {
      dom.search.value = uistate.searchText;
      if (dom.search.value.length == 0)
        dom.searchPlaceholder.classList.remove ("hidden");
      else
        dom.searchPlaceholder.classList.add ("hidden");
    }
    render();
    if (uistate.feelingLucky) {
      uistate.feelingLucky = false;
      activateSelectedResult();
    }
  }

  function onEscape (ev) {
    // hide the modal if it's visible or return to the previous result page and unfocus the search
    if (!dom.helpModalWrapper.classList.contains("hidden")) {
      dom.helpModalWrapper.classList.add("hidden");
      ev.preventDefault();
      ev.stopPropagation();
    }
    else {
      dom.search.value = "";
      dom.search.blur();
      dom.searchPlaceholder.classList.remove("hidden");
      uistate.searchIndex = -1;
      ev.preventDefault();
      ev.stopPropagation();
      startSearch();
    }
  }

  function onSearchKeyDown (ev) {
    switch (getEventKeyString (ev)) {
      case "Enter":
        // detect if this search changes anything
        let terms1 = getSearchTerms();
        startSearch();
        uistate.updateNav(document.location.hash);
        let terms2 = getSearchTerms();
        // we might have to wait for onHashChange to trigger
        uistate.feelingLucky = terms1.join(" ") !== terms2.join(" ");
        if (!uistate.feelingLucky) activateSelectedResult();
        ev.preventDefault();
        ev.stopPropagation();
        return;
      case "Esc":
        onEscape(ev);
        return
      case "Up":
        moveSearchCursor(-1);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      case "Down":
        moveSearchCursor(1);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      default:
        if (ev.shiftKey || ev.ctrlKey || ev.altKey) return;
        uistate.searchIndex = -1;
        ev.stopPropagation();
        startAsyncSearch();
        return;
    }
  }

  function onWindowKeyDown (ev) {
    switch (getEventKeyString (ev)) {
      case "Esc":
        onEscape(ev);
        break;
      case "s":
        if (dom.helpModalWrapper.classList.contains("hidden")) {
          if (ev.target == dom.search) break;
          dom.search.focus();
          dom.search.select();
          dom.docs.scrollTo(0, 0);
          ev.preventDefault();
          ev.stopPropagation();
          startAsyncSearch();
        }
        break;
      case "?":
        ev.preventDefault();
        ev.stopPropagation();
        showHelpModal();
        break;
    }
  }

  function onClickSearchShowAllResults (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    searchTrimResults = false;
    renderSearch();
  }

  function getEventKeyString  (ev) {
    let name;
    let ignoreShift = false;
    switch (ev.which) {
      case 13:
        name = "Enter";
        break;
      case 27:
        name = "Esc";
        break;
      case 38:
        name = "Up";
        break;
      case 40:
        name = "Down";
        break;
      default:
        ignoreShift = true;
        name =
          ev.key != null
            ? ev.key
            : String.fromCharCode(ev.charCode || ev.keyCode);
    }
    if (!ignoreShift && ev.shiftKey) name = "Shift+" + name;
    if (ev.altKey) name = "Alt+" + name;
    if (ev.ctrlKey) name = "Ctrl+" + name;
    return name;
  }

  // Stateful UI 

  function showHelpModal () {
    dom.helpModalWrapper.classList.remove("hidden");
    dom.search.blur();
  }

  function renderSearchCursor () {
    if (selectedSearchEntry != null)
      selectedSearchEntry.classList.remove ("selected")
    selectedSearchEntry = dom.listSearchResults.children [uistate.searchIndex];
    if (selectedSearchEntry) {
        selectedSearchEntry.classList.add ("selected")
        selectedSearchEntry.scrollIntoView();
    }
  }

  function moveSearchCursor (dir) {
    // alert ('moveSearchCursor '+dir)
    if (uistate.searchIndex < 0 ||
      uistate.searchIndex >= dom.listSearchResults.children.length) {
      if (dir > 0) {
        uistate.searchIndex = -1 + dir;
      } else if (dir < 0) {
        uistate.searchIndex = dom.listSearchResults.children.length + dir;
      }
    } else {
      uistate.searchIndex += dir;
    }
    if (uistate.searchIndex < 0) {
      uistate.searchIndex = 0;
    }
    if (uistate.searchIndex >= dom.listSearchResults.children.length) {
      uistate.searchIndex = dom.listSearchResults.children.length - 1;
    }
    renderSearchCursor();
  }

  function activateSelectedResult () {
    if (dom.sectSearchResults.classList.contains ("hidden"))
      return;

    let liDom = dom.listSearchResults.children [uistate.searchIndex];
    if (liDom == null && dom.listSearchResults.children.length !== 0) {
      liDom = dom.listSearchResults.children [0];
    }
    if (liDom != null) {
      let aDom = liDom.children [0];
      location.href = aDom.getAttribute("href");
      uistate.searchIndex = -1;
    }
    dom.search.blur();
  }

  function startAsyncSearch () {
    clearTimeout (searchTimer);
    searchTimer = setTimeout (startSearch, 100);
  }

  function startSearch () {
    clearTimeout (searchTimer);
    let oldHash = location.hash;
    let parts = oldHash.split ("?");
    let newPart2 = dom.search.value === "" ? "" : "?" + dom.search.value;
    location.replace (parts.length === 1 ? oldHash + newPart2 : parts[0] + newPart2);
  }

  function getSearchTerms () {
    let list = uistate.searchText.trim().split(/[ \r\n\t]+/);
    list.sort();
    return list;
  }

  function toggleExpand (event) {
    const parent = event.target.parentElement;
    parent.toggleAttribute("open");

    if (!parent.open && parent.getBoundingClientRect().top < 0) {
      parent.parentElement.parentElement.scrollIntoView(true);
    }
  }

  function toggleInternalDocMode () {
    if (this.checked != (uistate.nav.mode === NAV_MODES.API_INTERNAL)) {

      if (this.checked && location.hash.length > 1 && location.hash[1] != "a")
        return location.hash = "#a" + location.hash.substring(2);

      if (!this.checked && location.hash.length > 1 && location.hash[1] == "a")
        return location.hash = "#A" + location.hash.substring(2)
    }
  }

  // Model data iterators / transformers
  // These are used to lazily analyze the autodoc data
  // into viewmodel objects expected by the renderers

  function* iterateContainerFields (container, containerNode) {
    // containerNode = autodoc.getAstNode(container.src);
    for (let i=0, l = containerNode.fields.length; i<l; i++) {
      const fieldType = container.fields ? container.fields[i] : autodoc.getType (containerNode.fields[i])
      const field = autodoc.getAstNode (containerNode.fields[i])
      yield { container, field, fieldType }
    }
  }

  function* iterateFnParams (fnNode, fnType) {
    const { fields } = fnNode
    for (let i=0, l=fields.length; i<l; i++) {
      const { name, docs } = autodoc.getAstNode(fields[i]);
      const type = fnType.params[i]
      yield { name, type, docs }
    }
  }

  function* declLinks (declList) {
    for (const decl of declList) {
      const href = autodoc.navLinkDecl (uistate.nav, decl.name)
      const title = decl.name
      yield { href, title }
    }
  }

  function* packageLinks (packageList) {
    for (const { pkg, name } of packageList) {
      const href = autodoc.navLinkPkg (uistate.nav, pkg);
      yield { href, title:name, active:name === uistate.nav.pkgNames[0] }
    }
  }

  function* navigationLinks (nav) {
    const list = [], hrefPkgNames = [], hrefDeclNames = [];

    for (const name of nav.pkgNames) {
      hrefPkgNames.push (name);
      const href = autodoc.navLink(nav, hrefPkgNames, hrefDeclNames)
      yield { href, title:name }
    }

    for (const name of nav.declNames) {
      hrefDeclNames.push(name);
      const href = autodoc.navLink(nav, hrefPkgNames, hrefDeclNames)
      yield { href, title:name }
    }
  }

  function* searchResultLinks (matchedItems, maxLength = itemsLen) {
    const length = Math.min (matchedItems.length, maxLength)
    for (let i=0; i<length; i++) {
      const match = matchedItems[i]
      const lastPkgName = match.path.pkgNames[match.path.pkgNames.length - 1];
      const title = lastPkgName + "." + match.path.declNames.join(".");
      const href = autodoc.navLink(uistate.nav, match.path.pkgNames, match.path.declNames);
      yield { href, title }
    }
  }


}


// Helpers

function shortDesc (docs) {
  if (docs.length < 100) return docs
  let index = docs.indexOf("\n\n");
  if (index < 0 || index > 80) index = 80;
  return docs.substring (0, index) + '…';
}


// Main

main ()
