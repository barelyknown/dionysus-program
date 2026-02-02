local function stringify(el)
  return pandoc.utils.stringify(el)
end

local function split_section_title(text)
  local lead, subtitle = text:match("^(.-)%s+—%s+(.+)$")
  if not lead then
    lead, subtitle = text:match("^(.-)%s+%-%s+(.+)$")
  end
  if not lead then
    lead = text
  end
  return lead, subtitle
end

local function section_title_page(text)
  local lead, subtitle = split_section_title(text)
  local lines = ""
  if subtitle and subtitle ~= "" then
    lines = string.format("{\\Large\\scshape %s \\par}\n\\vspace{1.2cm}\n{\\Huge\\bfseries %s \\par}\n", lead, subtitle)
  else
    lines = string.format("{\\Huge\\bfseries %s \\par}\n", lead)
  end
  return string.format([[
\clearpage
\thispagestyle{empty}
\vspace*{\stretch{1}}
\begin{center}
%s\end{center}
\vspace*{\stretch{2}}
\clearpage
]], lines)
end

local function header_identifier(el)
  if el.identifier and el.identifier ~= "" then
    return el.identifier
  end
  if el.attr then
    if el.attr.identifier then
      return el.attr.identifier
    end
    if el.attr[1] and el.attr[1] ~= "" then
      return el.attr[1]
    end
  end
  return nil
end

local function is_about_program_header(el)
  if el.t ~= "Header" or el.level ~= 2 then
    return false
  end
  return header_identifier(el) == "about-the-program"
end

local function should_skip_section_page(el)
  if el.t ~= "Header" or el.level ~= 2 then
    return false
  end
  local id = header_identifier(el) or ""
  if id == "about-the-program" or id == "about-the-author" or id == "preface" or id == "foreword" then
    return true
  end
  local text = stringify(el.content)
  return text == "About the Program" or text == "About the Author" or text == "Preface" or text == "Foreword"
end

local function has_class(el, class)
  if not el.classes then
    return false
  end
  for _, c in ipairs(el.classes) do
    if c == class then
      return true
    end
  end
  return false
end

function Pandoc(doc)
  if not FORMAT:match('latex') then
    return doc
  end

  local description = pandoc.utils.stringify(doc.meta.description or '')
  local blocks = {}
  local removed_para = false

  for idx, el in ipairs(doc.blocks) do
    if not removed_para and el.t == 'Para' and description ~= '' then
      local text = stringify(el)
      if text == description then
        removed_para = true
        goto continue
      end
    end

    if el.t == "Header" and el.level == 2 and not should_skip_section_page(el) then
      local title = stringify(el.content)
      table.insert(blocks, pandoc.RawBlock('latex', section_title_page(title)))
    end

    if is_about_program_header(el) then
      local title = stringify(el.content)
      local id = header_identifier(el) or "about-the-program"
      local latex = string.format([[
\hypertarget{%s}{}
\phantomsection
\label{%s}
\addcontentsline{toc}{subsection}{%s}
{\Large\bfseries %s \par}
\vspace{6.3pt}
]], id, id, title, title)
      table.insert(blocks, pandoc.RawBlock("latex", latex))
      goto continue
    end

    if el.t == 'Div' and has_class(el, 'dedication') then
      local dedication_body = pandoc.write(pandoc.Pandoc(el.content), 'latex'):gsub('%s*$', '')
      local latex = string.format([[
\thispagestyle{empty}
\vspace*{\stretch{1}}
\begin{center}
%s
\end{center}
\vspace*{\stretch{2}}
\clearpage
]], dedication_body)
      table.insert(blocks, pandoc.RawBlock('latex', latex))
      goto continue
    end

    if el.t == 'Div' and has_class(el, 'about-program') then
      for _, block in ipairs(el.content) do
        table.insert(blocks, block)
      end
      goto continue
    end

    table.insert(blocks, el)
    ::continue::
  end

  doc.blocks = blocks
  return doc
end

function HorizontalRule(el)
  if FORMAT:match('latex') then
    return pandoc.RawBlock('latex', '\\bigskip')
  end
end
