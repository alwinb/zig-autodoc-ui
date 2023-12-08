const log = console.log.bind (console)

// Autodoc
// =======

// Autodoc class - wraps around a raw data json object
// and provides methods for querying it.

// The data object contains the following fields, where
// (most) of them are simply arrays; the Autodoc wrapper then
// turns these arrays into objects with human readable field names.

// * typeKinds // an array of stings -- (human readble) names
// * rootPkg
// * params
// * packages
// * errors
// * files
// * astNodes
// * calls
// * types // an array of tuples [tag, ...], or an array of objects { kind, ... }
// * decls
// * exprs
// * comptimeExprs
// * guides

const pointerSizeEnum =
   { One: 0, Many: 1, Slice: 2, C: 3 };

Autodoc.kindTagNames = [ // Added
  'unanalyzed',   'type',          'void',               'bool',      'noreturn',
  'int',          'float',         'pointer',            'array',     'struct',
  'comptimeExpr', 'comptimeFloat', 'comptimeInt',        'undefined', 'null',
  'optional',     'errorUnion',    'inferredErrorUnion', 'errorSet',  'enum',
  'union',        'function',      'boundFunction',      'opaque',    'frame',
  'anyframe',     'vector',        'enumLiteral'
]

function Autodoc (data) {
  
  // HACK for compat with older autodoc
  if ('modules' in data)
    data.packages = data.modules
  if ('rootMod' in data)
    data.rootPkg = data.rootMod


  const typeKinds = indexTypeKinds ();
  log({typeKinds})

  const typeTypeId = findTypeTypeId ();

  // for each package, is an array with packages to get to this one
  const canonPkgPaths = computeCanonicalPackagePaths ();

  // for each decl, is an array with {declNames, pkgNames} to get to this one
  let canonDeclPaths = null; // lazy; use getCanonDeclPath

  // for each type, is an array with {declNames, pkgNames} to get to this one
  let canonTypeDecls = null; // lazy; use getCanonTypeDecl

  // options
  // const sourceFileUrlTemplate = "txmt://open?url=file:///usr/local/lib/zig/std/{{file}}&line={{line}}"
  // const sourceFileUrlTemplate = "src/{{file}}.html#L{{line}}"
  const sourceFileUrlTemplate = "https://ziglang.org/documentation/0.11.0/std/src/std/{{file}}.html#L{{line}}"

  // API

  this.typeKinds = typeKinds
  this.pointerSizeEnum = pointerSizeEnum

  this.guides = data.guides
  this.exprs  = data.exprs
  this.decls  = data.decls
  this.params = data.params
  this.files  = data.files
  this.calls  = data.calls
  this.comptimeExprs = data.comptimeExprs

  Object.assign (this, {
    getPackage,  getPackageList, getRootPackage, search, getContainerInfo, // added
    isType, isDecl, isContainerType,
    getType, getDecl, getAstNode, getErrorList,
    typeIsGenericFn,
    findSubDecl, resolveValue,
    navLink, navLinkPkg, navLinkDecl, findDeclNavLink,
    sourceFileLink, typeShorthandName,
    shouldSkipParamName, detectRootIsStd, getCanonDeclPath,
  })

  return this

  // Methods

  // Initialisation

  // data.typeKinds is an array of strings consisting of the strings
  // in assertList below. indexTypeKinds converts the array (seen as
  // a map index -> string) into its inverse map: a dictionary object
  // from string -> int.

  function indexTypeKinds () {
    const map = {};
    for (let i = 0; i < data.typeKinds.length; i += 1) {
      map[data.typeKinds[i]] = i;
    }
    // This is just for debugging purposes, not needed to function
    const assertList = [
      "Type", "Void", "Bool", "NoReturn", "Int", "Float", "Pointer",
      "Array", "Struct", "ComptimeFloat", "ComptimeInt", "Undefined",
      "Null", "Optional", "ErrorUnion", "ErrorSet", "Enum", "Union",
      "Fn", "Opaque", "Frame", "AnyFrame", "Vector", "EnumLiteral",
    ];
    for (let i = 0; i < assertList.length; i += 1) {
      if (map[assertList[i]] == null)
        throw new Error("No type kind '" + assertList[i] + "' found");
    }
    return map;
  }

  function computeCanonicalPackagePaths () {
    let list = new Array (data.packages.length);
    // Now we try to find all the packages from root.
    let rootPkg = data.packages [data.rootPkg];
    // Breadth-first to keep the path shortest possible.
    let stack = [{ path: [], pkg: rootPkg }];
    while (stack.length !== 0) {
      let item = stack.shift ();
      for (const key in item.pkg.table) {
        const childPkgIndex = item.pkg.table [key];
        if (list [childPkgIndex] != null) continue;
        let childPkg = data.packages [childPkgIndex];
        if (childPkg == null) continue;
        const newPath = item.path.concat ([key]);
        list [childPkgIndex] = newPath;
        stack.push ({ path: newPath, pkg: childPkg});
      }
    }
    return list;
  }

  function computeCanonDeclPaths() {
    let list = new Array (data.decls.length);
    canonTypeDecls = new Array (data.types.length);

    for (let pkgI = 0; pkgI < data.packages.length; pkgI += 1) {
      let pkg = data.packages[pkgI];
      let pkgNames = canonPkgPaths[pkgI];
      if (pkgNames === undefined) continue;

      const stack = [{ declNames: [], type: getType (pkg.main) }];
      while (stack.length !== 0) {
        let item = stack.shift();

        if (isContainerType(item.type)) {
          let t = item.type;

          let len = t.pubDecls ? t.pubDecls.length : 0;
          for (let declI = 0; declI < len; declI += 1) {
            let mainDeclIndex = t.pubDecls[declI];
            if (list[mainDeclIndex] != null) continue;

            let decl = getDecl(mainDeclIndex);
            let declVal = resolveValue(decl.value);
            let declNames = item.declNames.concat([decl.name]);
            list [mainDeclIndex] = { pkgNames, declNames };

            if ("type" in declVal.expr) {
              let value = getType(declVal.expr.type);
              if (declCanRepresentTypeKind(value.kind)) {
                canonTypeDecls[declVal.type] = mainDeclIndex;
              }

              if (isContainerType(value)) {
                stack.push ({ declNames, type: value });
              }

              // Generic function
              if (value.kind == typeKinds.Fn && value.generic_ret != null) {
                let resolvedVal = resolveValue({ expr: value.generic_ret });
                if ("type" in resolvedVal.expr) {
                  let generic_type = getType(resolvedVal.expr.type);
                  if (isContainerType(generic_type)) {
                    stack.push ({ declNames, type: generic_type });
                  }
                }
              }
            }

          }
        }
      }
    }
    return list;
  }

  // Querying

  function search (searchText, ignoreCase) {
    let matchedItems = [];
    let terms = searchText .trim () .split (/[ \r\n\t]+/);
    terms .sort ();

    decl_loop: for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
      const canonPath = getCanonDeclPath (declIndex);
      if (canonPath == null) continue;

      // TODO Want to add scoping to points, eg. use current path location
      // but, where was that stored?
      // log ("===>" searchText)

      let decl = getDecl (declIndex);
      let lastPkgName = canonPath.pkgNames[canonPath.pkgNames.length - 1];
      let fullPathSearchText = lastPkgName + "." + canonPath.declNames.join(".");
      let astNode = getAstNode(decl.src);
      let fileAndDocs = ""; // data.files[astNode.file];
      // TODO: understand what this piece of code is trying to achieve
      //       also right now `files` are expressed as a hashmap.
      if (astNode.docs != null) {
        fileAndDocs += "\n" + astNode.docs;
      }
      let fullPathSearchTextLower = fullPathSearchText;
      if (ignoreCase) {
        fullPathSearchTextLower = fullPathSearchTextLower.toLowerCase();
        fileAndDocs = fileAndDocs.toLowerCase();
      }

      let points = 0;
      for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
        let term = terms[termIndex];

        // exact, case sensitive match of full decl path
        if (fullPathSearchText === term) {
          points += 4;
          continue;
        }
        // exact, case sensitive match of just decl name
        if (decl.name == term) {
          points += 3;
          continue;
        }
        // substring, case insensitive match of full decl path
        if (fullPathSearchTextLower.indexOf(term) >= 0) {
          points += 2;
          continue;
        }
        if (fileAndDocs.indexOf(term) >= 0) {
          points += 1;
          continue;
        }

        continue decl_loop;
      }

      matchedItems.push ({ decl, path:canonPath, points });
    }

    matchedItems.sort ((a, b) =>
      cmp (b.points, a.points) || cmp (a.decl.name, b.decl.name));

    return matchedItems;
  }

  function getRootPackage () {
    return data.packages[data.rootPkg]
  }

  function getPackage (idx) {
    return data.packages[idx]
  }

  function getPackageList (rootPkg = getRootPackage()) {
    const list = [];
    for (let key in rootPkg.table) {
      const pkgIndex = rootPkg.table[key];
      if (getPackage(pkgIndex) == null) continue;
      if (key == rootPkg.name) continue;
      list.push ({ name: key, pkg: pkgIndex });
    }
    return list
  }

  function getAstNode (idx) {
    const ast = data.astNodes[idx];
    return {
      file: ast[0],
      line: ast[1],
      col: ast[2],
      name: ast[3],
      code: ast[4],
      docs: ast[5],
      fields: ast[6],
      comptime: ast[7],
    };
  }

  // 2023-04-02 // It seems that the data generated from
  // zig v-10 stores types and decls as objects rather than
  // as tuples (arrays) - alwin

  function getDecl (idx) {
    const decl = data.decls[idx];
    if (isDecl (decl))
      return decl // added

    // else build decl object from tuple:
    return {
      name: decl[0],
      kind: decl[1],
      src: decl[2],
      value: decl[3],
      decltest: decl[4],
    };
  }

  function getType (idx) {
    const ty = data.types [idx];
    if (isType (ty))
      return ty // added

    // else build type object from tuple:
    switch (ty[0]) {
      default:
        throw "unhandled type kind!";
      case 0: // Unanalyzed
        throw "unanalyzed type!";
      case 1: // Type
      case 2: // Void
      case 3: // Bool
      case 4: // NoReturn
      case 5: // Int
      case 6: // Float
        return { kind: ty[0], name: ty[1] };
      case 7: // Pointer
        return {
          kind: ty[0],
          size: ty[1],
          child: ty[2],
          sentinel: ty[3],
          align: ty[4],
          address_space: ty[5],
          bit_start: ty[6],
          host_size: ty[7],
          is_ref: ty[8],
          is_allowzero: ty[9],
          is_mutable: ty[10],
          is_volatile: ty[11],
          has_sentinel: ty[12],
          has_align: ty[13],
          has_addrspace: ty[14],
          has_bit_range: ty[15],
        };
      case 8: // Array
        return {
          kind: ty[0],
          len: ty[1],
          child: ty[2],
          sentinel: ty[3],
        };
      case 9: // Struct
        return {
          kind: ty[0],
          name: ty[1],
          src: ty[2],
          privDecls: ty[3],
          pubDecls: ty[4],
          fields: ty[5],
          is_tuple: ty[6],
          line_number: ty[7],
          outer_decl: ty[8],
        };
      case 10: // ComptimeExpr
      case 11: // ComptimeFloat
      case 12: // ComptimeInt
      case 13: // Undefined
      case 14: // Null
        return { kind: ty[0], name: ty[1] };
      case 15: // Optional
        return {
          kind: ty[0],
          name: ty[1],
          child: ty[2],
        };
      case 16: // ErrorUnion
        return {
          kind: ty[0],
          lhs: ty[1],
          rhs: ty[2],
        };
      case 17: // InferredErrorUnion
        return {
          kind: ty[0],
          payload: ty[1],
        };
      case 18: // ErrorSet
        return {
          kind: ty[0],
          name: ty[1],
          fields: ty[2],
        };
      case 19: // Enum
        return {
          kind: ty[0],
          name: ty[1],
          src: ty[2],
          privDecls: ty[3],
          pubDecls: ty[4],
          tag: ty[5],
          nonexhaustive: ty[6],
        };
      case 20: // Union
        return {
          kind: ty[0],
          name: ty[1],
          src: ty[2],
          privDecls: ty[3],
          pubDecls: ty[4],
          fields: ty[5],
          tag: ty[6],
          auto_tag: ty[7],
        };
      case 21: // Fn
        return {
          kind: ty[0],
          name: ty[1],
          src: ty[2],
          ret: ty[3],
          generic_ret: ty[4],
          params: ty[5],
          lib_name: ty[6],
          is_var_args: ty[7],
          is_inferred_error: ty[8],
          has_lib_name: ty[9],
          has_cc: ty[10],
          cc: ty[11],
          align: ty[12],
          has_align: ty[13],
          is_test: ty[14],
          is_extern: ty[15],
        };
      case 22: // BoundFn
        return { kind: ty[0], name: ty[1] };
      case 23: // Opaque
        return {
          kind: ty[0],
          name: ty[1],
          src: ty[2],
          privDecls: ty[3],
          pubDecls: ty[4],
        };
      case 24: // Frame
      case 25: // AnyFrame
      case 26: // Vector
      case 27: // EnumLiteral
        return { kind: ty[0], name: ty[1] };
    }
  }

  function findTypeTypeId () {
    for (let i = 0; i < data.types.length; i += 1) {
      try {
        if (getType(i).kind == typeKinds.Type) {
        return i;
      } } catch (e) { /* ... */ }
    }
    // 'hack it, use -1 as default index then -alwin
    // TODO
    throw new Error("No type 'type' found");
  }

  function isDecl (x) {
    return "value" in x;
  }

  function isType (x) {
    return "kind" in x && !("value" in x);
  }

  function isContainerType (x) {
    return isType (x) && typeKindIsContainer (x.kind);
  }

  function typeIsErrSet (typeIndex) {
    let typeObj = getType (typeIndex);
    return typeObj.kind === typeKinds.ErrorSet;
  }

  function getErrorList (errSetType) {
    const errorList = errSetType.fields.slice (0)
    errorList.sort ((a, b) => cmp (a.name.toLowerCase(), b.name.toLowerCase()))
    return errorList
  }

  function typeIsStructWithNoFields (typeIndex) {
    let typeObj = getType (typeIndex);
    if (typeObj.kind !== typeKinds.Struct) return false;
    return typeObj.fields.length == 0;
  }

  function typeIsGenericFn (typeIndex) {
    let typeObj = getType(typeIndex);
    if (typeObj.kind !== typeKinds.Fn) {
      return false;
    }
    return typeObj.generic_ret != null;
  }

  function typeKindIsContainer (typeKind) {
    return (
      typeKind === typeKinds.Struct ||
      typeKind === typeKinds.Union ||
      typeKind === typeKinds.Enum ||
      typeKind === typeKinds.Opaque
    );
  }

  function resolveValue (value) {
    let i = 0;
    while (i < 1000) {
      i += 1;

      if ("refPath" in value.expr) {
        value = { expr: value.expr.refPath[value.expr.refPath.length - 1] };
        continue;
      }

      if ("declRef" in value.expr) {
        value = getDecl(value.expr.declRef).value;
        continue;
      }

      if ("as" in value.expr) {
        value = {
          typeRef: data.exprs[value.expr.as.typeRefArg],
          expr: data.exprs[value.expr.as.exprArg],
        };
        continue;
      }

      return value;
    }
    console.assert(false);
    return {};
  }

  function getCanonDeclPath (index) {
    if (canonDeclPaths == null) {
      canonDeclPaths = computeCanonDeclPaths();
    }
    //let cd = (canonDeclPaths);
    return canonDeclPaths[index];
  }

  function getCanonTypeDecl (index) {
    getCanonDeclPath(0);
    //let ct = (canonTypeDecls);
    return canonTypeDecls[index];
  }

  function getPtrSize (typeObj) {
    return typeObj.size == null ? pointerSizeEnum.One : typeObj.size;
  }

  function shouldSkipParamName (typeRef, paramName) {
    let resolvedTypeRef = resolveValue({ expr: typeRef });
    if ("type" in resolvedTypeRef) {
      let typeObj = getType(resolvedTypeRef.type);
      if (typeObj.kind === typeKinds.Pointer) {
        let ptrObj = typeObj;
        if (getPtrSize(ptrObj) === pointerSizeEnum.One) {
          const value = resolveValue(ptrObj.child);
          return typeValueName(value, false, true).toLowerCase() === paramName;
        }
      }
    }
    return false;
  }

  function detectRootIsStd () {
    let rootPkg = getRootPackage();
    if (rootPkg.table["std"] == null) {
      // no std mapped into the root package
      return false;
    }
    let stdPkg = getPackage(rootPkg.table["std"]);
    if (stdPkg == null) return false;
    return rootPkg.file === stdPkg.file;
  }

  function getContainerInfo (container, { internalApiMode = false } = { }) {
    const _into = { 
      types: [], namespaces: [], errSets: [], 
      fns: [], vars: [], vals: [], tests: [] }

    categorizeDecls (container.pubDecls, _into);
    if (internalApiMode) categorizeDecls (container.privDecls, _into);

    for (const k in _into) _into[k] .sort (byNameProperty);
    return _into
  }

  function categorizeDecls (decls, into) {
    for (let i = 0; i < decls.length; i += 1) {
      let decl = getDecl(decls[i]);
      let declValue = resolveValue(decl.value);

      // if (decl.isTest) {
      //   testsList.push(decl);
      //   continue;
      // }

      if (decl.kind === "var") {
        into.vars.push (decl);
        continue;
      }

      if (decl.kind === "const") {
        if ("type" in declValue.expr) {
          // We have the actual type expression at hand.
          const typeExpr = getType(declValue.expr.type);
          if (typeExpr.kind == typeKinds.Fn) {
            const funcRetExpr = resolveValue({ expr: typeExpr.ret });
            if ("type" in funcRetExpr.expr && funcRetExpr.expr.type == typeTypeId) {
              if (typeIsErrSet(declValue.expr.type))
                into.errSets.push (decl);
              else if (typeIsStructWithNoFields(declValue.expr.type))
                into.namespaces.push (decl);
              else into.types.push (decl);
            }
            else into.fns.push (decl);
          }
          else {
            if (typeIsErrSet(declValue.expr.type))
              into.errSets.push (decl);
            else if (typeIsStructWithNoFields(declValue.expr.type))
              into.namespaces.push (decl);
            else into.types.push (decl);
          }
        }

        else if (declValue.typeRef) {
          if ("type" in declValue.typeRef && declValue.typeRef == typeTypeId) {
            // We don't know what the type expression is, but we know it's a type.
            into.types.push (decl);
          }
          else into.vals.push (decl);
        }
        else into.vals.push (decl);
      }
    }
  }

  function typeShorthandName (expr) {
    let resolvedExpr = resolveValue ({ expr: expr });
    if (!("type" in resolvedExpr)) return null;

    let type = getType (resolvedExpr.type);
    outer: for (let i = 0; i < 10000; i += 1) {
      switch (type.kind) {
        case typeKinds.Optional:
        case typeKinds.Pointer:
          let child = type.child;
          let resolvedChild = resolveValue(child);
          if ("type" in resolvedChild) {
            type = getType(resolvedChild.type);
            continue;
          }
          else return null;
        default:
          break outer;
      }

      if (i == 9999) throw "Exhausted typeShorthandName quota";
    }

    let name = undefined;
    if (type.kind === typeKinds.Struct) name = "struct";
    else if (type.kind === typeKinds.Enum) name = "enum";
    else if (type.kind === typeKinds.Union) name = "union";
    else {
      console.log("TODO: unhandled case in typeShortName");
      return null;
    }

    return escapeHtml (name);
  }

  function declCanRepresentTypeKind (typeKind) {
    return typeKind === typeKinds.ErrorSet || typeKindIsContainer(typeKind);
  }

  function sourceFileLink (decl) {
    const srcNode = getAstNode(decl.src);
    log (data.files[srcNode.file])
    return sourceFileUrlTemplate.
      replace("{{file}}", data.files[srcNode.file][0]).
      replace("{{line}}", srcNode.line + 1);
  }

  function navLink (curNav, pkgNames, declNames, callName) {
    let base = curNav.mode;
    if (pkgNames.length === 0 && declNames.length === 0) {
      return base;
    }
    else if (declNames.length === 0 && callName == null) {
      return base + pkgNames.join(".");
    }
    else if (callName == null) {
      return base + pkgNames.join(".") + ":" + declNames.join(".");
    }
    else {
      return (
        base + pkgNames.join(".") + ":" + declNames.join(".") + ";" + callName
      );
    }
  }

  function navLinkPkg(curNav, pkgIndex = data.rootPkg) {
    return navLink(curNav, canonPkgPaths[pkgIndex], []);
  }

  function navLinkDecl(curNav, childName) {
    return navLink(curNav, curNav.pkgNames, curNav.declNames.concat([childName]));
  }

  function findSubDecl(parentTypeOrDecl, childName) {
    let parentType = parentTypeOrDecl;
    {
      // Generic functions / resorlving decls
      if ("value" in parentType) {
        const rv = resolveValue(parentType.value);
        if ("type" in rv.expr) {
          const t = getType(rv.expr.type);
          parentType = t;
          if (t.kind == typeKinds.Fn && t.generic_ret != null) {
            let resolvedGenericRet = resolveValue({ expr: t.generic_ret });

            if ("call" in resolvedGenericRet.expr) {
              let call = data.calls[resolvedGenericRet.expr.call];
              let resolvedFunc = resolveValue({ expr: call.func });
              if (!("type" in resolvedFunc.expr)) return null;
              let callee = getType(resolvedFunc.expr.type);
              if (!callee.generic_ret) return null;
              resolvedGenericRet = resolveValue({ expr: callee.generic_ret });
            }

            if ("type" in resolvedGenericRet.expr) {
              parentType = getType(resolvedGenericRet.expr.type);
            }
          }
        }
      }
    }

    if (!parentType.pubDecls) return null;
    for (let i = 0; i < parentType.pubDecls.length; i += 1) {
      let declIndex = parentType.pubDecls[i];
      let childDecl = getDecl(declIndex);
      if (childDecl.name === childName) {
        return childDecl;
      }
    }
    if (!parentType.privDecls) return null;
    for (let i = 0; i < parentType.privDecls.length; i += 1) {
      let declIndex = parentType.privDecls[i];
      let childDecl = getDecl(declIndex);
      if (childDecl.name === childName) {
        return childDecl;
      }
    }
    return null;
  }

  function findDeclNavLink (curNav, declName) {
    if (curNav.declObjs.length == 0) return null;
    const curFile = getAstNode(curNav.declObjs[curNav.declObjs.length - 1].src).file;

    for (let i = curNav.declObjs.length - 1; i >= 0; i--) {
      const curDecl = curNav.declObjs[i];
      const curDeclName = curNav.declNames[i - 1];
      if (curDeclName == declName) {
        const declPath = curNav.declNames.slice(0, i);
        return navLink(curNav, curNav.pkgNames, declPath);
      }

      if (findSubDecl(curDecl, declName) != null) {
        const declPath = curNav.declNames.slice(0, i).concat([declName]);
        return navLink(curNav, curNav.pkgNames, declPath);
      }
    }
    //throw("could not resolve links for '" + declName + "'");
  }

  // Helpers

  function byNameProperty (a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }

  function cmp (a, b) {
    return a < b ? -1 : a > b ? 1 : 0
  }

  // function indexNodesToCalls() {
  //     let map = {};
  //     for (let i = 0; i < data.calls.length; i += 1) {
  //         let call = data.calls[i];
  //         let fn = data.fns[call.fn];
  //         if (map[fn.src] == null) {
  //             map[fn.src] = [i];
  //         } else {
  //             map[fn.src].push(i);
  //         }
  //     }
  //     return map;
  // }

  // function findCteInRefPath(path) {
  //     for (let i = path.length - 1; i >= 0; i -= 1) {
  //         const ref = path[i];
  //         if ("string" in ref) continue;
  //         if ("comptimeExpr" in ref) return ref;
  //         if ("refPath" in ref) return findCteInRefPath(ref.refPath);
  //         return null;
  //     }
  //     return null;
  // }

  //  function navLinkCall(callObj) {
  //      let declNamesCopy = curNav.declNames.concat([]);
  //      let callName = (declNamesCopy.pop());
  //      callName += '(';
  //          for (let arg_i = 0; arg_i < callObj.args.length; arg_i += 1) {
  //              if (arg_i !== 0) callName += ',';
  //              let argObj = callObj.args[arg_i];
  //              callName += getValueText(argObj, argObj, false, false);
  //          }
  //          callName += ')';
  //      declNamesCopy.push(callName);
  //      return navLink(curNav.pkgNames, declNamesCopy);
  //  }

  // function typeOfDecl(decl){
  //   return decl.value.typeRef;
  //
  //   let i = 0;
  //   while(i < 1000) {
  //      i += 1;
  //      console.assert(isDecl(decl));
  //      if ("type" in decl.value) {
  //          return ({ type: typeTypeId });
  //      }
  //
  //   // if ("string" in decl.value) {
  //   //     return ({ type: {
  //   //       kind: typeKinds.Pointer,
  //   //       size: pointerSizeEnum.One,
  //   //       child: });
  //   // }
  //
  //      if ("refPath" in decl.value) {
  //          decl =  ({
  //            value: decl.value.refPath[decl.value.refPath.length -1]
  //          });
  //          continue;
  //      }
  //
  //      if ("declRef" in decl.value) {
  //          decl = data.decls[decl.value.declRef];
  //          continue;
  //      }
  //
  //      if ("int" in decl.value) {
  //          return decl.value.int.typeRef;
  //      }
  //
  //      if ("float" in decl.value) {
  //          return decl.value.float.typeRef;
  //      }
  //
  //      if ("array" in decl.value) {
  //          return decl.value.array.typeRef;
  //      }
  //
  //      if ("struct" in decl.value) {
  //          return decl.value.struct.typeRef;
  //      }
  //
  //      if ("comptimeExpr" in decl.value) {
  //          const cte = data.comptimeExprs[decl.value.comptimeExpr];
  //          return cte.typeRef;
  //      }
  //
  //      if ("call" in decl.value) {
  //          const fn_call = data.calls[decl.value.call];
  //          let fn_decl = undefined;
  //          if ("declRef" in fn_call.func) {
  //              fn_decl = data.decls[fn_call.func.declRef];
  //          } else if ("refPath" in fn_call.func) {
  //              console.assert("declRef" in fn_call.func.refPath[fn_call.func.refPath.length -1]);
  //              fn_decl = data.decls[fn_call.func.refPath[fn_call.func.refPath.length -1].declRef];
  //          } else throw {};
  //
  //          const fn_decl_value = resolveValue(fn_decl.value);
  //          console.assert("type" in fn_decl_value); //TODO handle comptimeExpr
  //          const fn_type = (data.types[fn_decl_value.type]);
  //          console.assert(fn_type.kind === typeKinds.Fn);
  //          return fn_type.ret;
  //      }
  //
  //      if ("void" in decl.value) {
  //          return ({ type: typeTypeId });
  //      }
  //
  //      if ("bool" in decl.value) {
  //          return ({ type: typeKinds.Bool });
  //      }
  //
  //      console.log("TODO: handle in `typeOfDecl` more cases: ", decl);
  //      console.assert(false);
  //      throw {};
  //   }
  //   console.assert(false);
  //   return ({});
  // }

  // function allCompTimeFnCallsHaveTypeResult(typeIndex, value) {
  //   let srcIndex = data.fns[value].src;
  //   let calls = nodesToCallsMap[srcIndex];
  //   if (calls == null) return false;
  //   for (let i = 0; i < calls.length; i += 1) {
  //       let call = data.calls[calls[i]];
  //       if (call.result.type !== typeTypeId) return false;
  //   }
  //   return true;
  // }

  // function allCompTimeFnCallsResult(calls) {
  //     let firstTypeObj = null;
  //     let containerObj = {
  //         privDecls: [],
  //     };
  //     for (let callI = 0; callI < calls.length; callI += 1) {
  //         let call = autodoc.calls[calls[callI]];
  //         if (call.result.type !== typeTypeId) return null;
  //         let typeObj = autodoc.types[call.result.value];
  //         if (!typeKindIsContainer(typeObj.kind)) return null;
  //         if (firstTypeObj == null) {
  //             firstTypeObj = typeObj;
  //             containerObj.src = typeObj.src;
  //         } else if (firstTypeObj.src !== typeObj.src) {
  //             return null;
  //         }
  //
  //         if (containerObj.fields == null) {
  //             containerObj.fields = (typeObj.fields || []).concat([]);
  //         } else for (let fieldI = 0; fieldI < typeObj.fields.length; fieldI += 1) {
  //             let prev = containerObj.fields[fieldI];
  //             let next = typeObj.fields[fieldI];
  //             if (prev === next) continue;
  //             if (typeof(prev) === 'object') {
  //                 if (prev[next] == null) prev[next] = typeObj;
  //             } else {
  //                 containerObj.fields[fieldI] = {};
  //                 containerObj.fields[fieldI][prev] = firstTypeObj;
  //                 containerObj.fields[fieldI][next] = typeObj;
  //             }
  //         }
  //
  //         if (containerObj.pubDecls == null) {
  //             containerObj.pubDecls = (typeObj.pubDecls || []).concat([]);
  //         } else for (let declI = 0; declI < typeObj.pubDecls.length; declI += 1) {
  //             let prev = containerObj.pubDecls[declI];
  //             let next = typeObj.pubDecls[declI];
  //             if (prev === next) continue;
  //             // TODO instead of showing "examples" as the public declarations,
  //                 // do logic like this:
  //             //if (typeof(prev) !== 'object') {
  //                 //    let newDeclId = autodoc.decls.length;
  //                 //    prev = clone(autodoc.decls[prev]);
  //                 //    prev.id = newDeclId;
  //                 //    autodoc.decls.push(prev);
  //                 //    containerObj.pubDecls[declI] = prev;
  //                 //}
  //             //mergeDecls(prev, next, firstTypeObj, typeObj);
  //         }
  //     }
  //     for (let declI = 0; declI < containerObj.pubDecls.length; declI += 1) {
  //         let decl = containerObj.pubDecls[declI];
  //         if (typeof(decl) === 'object') {
  //             containerObj.pubDecls[declI] = containerObj.pubDecls[declI].id;
  //         }
  //     }
  //     return containerObj;
  // }
}

globalThis.AutodocModule = { Autodoc }
// export { Autodoc }