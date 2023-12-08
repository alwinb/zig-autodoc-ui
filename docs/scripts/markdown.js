
const escapeHtmlReplacements = {
  "&": "&amp;", '"': "&quot;",
  "<": "&lt;", ">": "&gt;",
};

function escapeHtml (text = '') {
  return text.replace (/[&"<>]/g, m => escapeHtmlReplacements[m]);
}

function markdown(input) {
  const raw_lines = input.split("\n"); // zig allows no '\r', so we don't need to split on CR

  const lines = [];

  // PHASE 1:
  // Dissect lines and determine the type for each line.
  // Also computes indentation level and removes unnecessary whitespace

  let is_reading_code = false;
  let code_indent = 0;
  for (let line_no = 0; line_no < raw_lines.length; line_no++) {
    const raw_line = raw_lines[line_no];

    const line = {
      indent: 0,
      raw_text: raw_line,
      text: raw_line.trim(),
      type: "p", // p, h1 … h6, code, ul, ol, blockquote, skip, empty
      ordered_number: -1, // NOTE: hack to make the type checker happy
    };

    if (!is_reading_code) {
      while (
        line.indent < line.raw_text.length &&
        line.raw_text[line.indent] == " "
      ) {
        line.indent += 1;
      }

      if (line.text.startsWith("######")) {
        line.type = "h6";
        line.text = line.text.substr(6);
      } else if (line.text.startsWith("#####")) {
        line.type = "h5";
        line.text = line.text.substr(5);
      } else if (line.text.startsWith("####")) {
        line.type = "h4";
        line.text = line.text.substr(4);
      } else if (line.text.startsWith("###")) {
        line.type = "h3";
        line.text = line.text.substr(3);
      } else if (line.text.startsWith("##")) {
        line.type = "h2";
        line.text = line.text.substr(2);
      } else if (line.text.startsWith("#")) {
        line.type = "h1";
        line.text = line.text.substr(1);
      } else if (line.text.match(/^-[ \t]+.*$/)) {
        // line starts with a hyphen, followed by spaces or tabs
        const match = line.text.match(/^-[ \t]+/);
        line.type = "ul";
        line.text = line.text.substr(match[0].length);
      } else if (line.text.match(/^\d+\.[ \t]+.*$/)) {
        // line starts with {number}{dot}{spaces or tabs}
        const match = line.text.match(/(\d+)\.[ \t]+/);
        line.type = "ol";
        line.text = line.text.substr(match[0].length);
        line.ordered_number = Number(match[1].length);
      } else if (line.text == "```") {
        line.type = "skip";
        is_reading_code = true;
        code_indent = line.indent;
      } else if (line.text == "") {
        line.type = "empty";
      }
    } else {
      if (line.text == "```") {
        is_reading_code = false;
        line.type = "skip";
      } else {
        line.type = "code";
        line.text = line.raw_text.substr(code_indent); // remove the indent of the ``` from all the code block
      }
    }

    if (line.type != "skip") {
      lines.push(line);
    }
  }

  // PHASE 2:
  // Render HTML from markdown lines.
  // Look at each line and emit fitting HTML code

  function markdownInlines(innerText) {
    // inline types:
    // **{INLINE}**       : <strong>
    // __{INLINE}__       : <u>
    // ~~{INLINE}~~       : <s>
    //  *{INLINE}*        : <emph>
    //  _{INLINE}_        : <emph>
    //  `{TEXT}`          : <code>
    //  [{INLINE}]({URL}) : <a>
    // ![{TEXT}]({URL})   : <img>
    // [[std;format.fmt]] : <a> (inner link)

    const formats = [
      {
        marker: "**",
        tag: "strong",
      },
      {
        marker: "~~",
        tag: "s",
      },
      {
        marker: "__",
        tag: "u",
      },
      {
        marker: "*",
        tag: "em",
      },
    ];

    const stack = [];

    let innerHTML = "";
    let currentRun = "";

    function flushRun() {
      if (currentRun != "") {
        innerHTML += escapeHtml(currentRun);
      }
      currentRun = "";
    }

    let parsing_code = false;
    let codetag = "";
    let in_code = false;

    for (let i = 0; i < innerText.length; i++) {
      if (parsing_code && in_code) {
        if (innerText.substr(i, codetag.length) == codetag) {
          // remove leading and trailing whitespace if string both starts and ends with one.
          if (
            currentRun[0] == " " &&
            currentRun[currentRun.length - 1] == " "
          ) {
            currentRun = currentRun.substr(1, currentRun.length - 2);
          }
          flushRun();
          i += codetag.length - 1;
          in_code = false;
          parsing_code = false;
          innerHTML += "</code>";
          codetag = "";
        } else {
          currentRun += innerText[i];
        }
        continue;
      }

      if (innerText[i] == "`") {
        flushRun();
        if (!parsing_code) {
          innerHTML += "<code>";
        }
        parsing_code = true;
        codetag += "`";
        continue;
      }

      if (parsing_code) {
        currentRun += innerText[i];
        in_code = true;
      } else {
        let any = false;
        for (
          let idx = stack.length > 0 ? -1 : 0;
          idx < formats.length;
          idx++
        ) {
          const fmt = idx >= 0 ? formats[idx] : stack[stack.length - 1];
          if (innerText.substr(i, fmt.marker.length) == fmt.marker) {
            flushRun();
            if (stack[stack.length - 1] == fmt) {
              stack.pop();
              innerHTML += "</" + fmt.tag + ">";
            } else {
              stack.push(fmt);
              innerHTML += "<" + fmt.tag + ">";
            }
            i += fmt.marker.length - 1;
            any = true;
            break;
          }
        }
        if (!any) {
          currentRun += innerText[i];
        }
      }
    }
    flushRun();

    if (in_code) {
      in_code = false;
      parsing_code = false;
      innerHTML += "</code>";
      codetag = "";
    }

    while (stack.length > 0) {
      const fmt = stack.pop();
      innerHTML += "</" + fmt.tag + ">";
    }

    return innerHTML;
  }

  function previousLineIs(type, line_no) {
    if (line_no > 0) {
      return lines[line_no - 1].type == type;
    } else {
      return false;
    }
  }

  function nextLineIs(type, line_no) {
    if (line_no < lines.length - 1) {
      return lines[line_no + 1].type == type;
    } else {
      return false;
    }
  }

  function getPreviousLineIndent(line_no) {
    if (line_no > 0) {
      return lines[line_no - 1].indent;
    } else {
      return 0;
    }
  }

  function getNextLineIndent(line_no) {
    if (line_no < lines.length - 1) {
      return lines[line_no + 1].indent;
    } else {
      return 0;
    }
  }

  let html = "";
  for (let line_no = 0; line_no < lines.length; line_no++) {
    const line = lines[line_no];

    switch (line.type) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        html +=
          "<" +
          line.type +
          ">" +
          markdownInlines(line.text) +
          "</" +
          line.type +
          ">\n";
        break;

      case "ul":
      case "ol":
        if (
          !previousLineIs(line.type, line_no) ||
          getPreviousLineIndent(line_no) < line.indent
        ) {
          html += "<" + line.type + ">\n";
        }

        html += "<li>" + markdownInlines(line.text) + "</li>\n";

        if (
          !nextLineIs(line.type, line_no) ||
          getNextLineIndent(line_no) < line.indent
        ) {
          html += "</" + line.type + ">\n";
        }
        break;

      case "p":
        if (!previousLineIs("p", line_no)) {
          html += "<p>\n";
        }
        html += markdownInlines(line.text) + "\n";
        if (!nextLineIs("p", line_no)) {
          html += "</p>\n";
        }
        break;

      case "code":
        if (!previousLineIs("code", line_no)) {
          html += "<pre><code>";
        }
        html += escapeHtml(line.text) + "\n";
        if (!nextLineIs("code", line_no)) {
          html += "</code></pre>\n";
        }
        break;
    }
  }

  return html;
}


// Exports
// -------

// export { markdown, escapeHtml }
globalThis.MarkdownModule = { markdown, escapeHtml }
