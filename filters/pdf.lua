local function stringify(el)
  return pandoc.utils.stringify(el)
end

local function is_act_header(el)
  if el.t == "Header" and el.level == 2 then
    local text = stringify(el.content)
    return text:match("^Act ") ~= nil
  end
  return false
end

local function split_act_title(text)
  local act, subtitle = text:match("^(Act%s+[^%s]+)%s+—%s+(.+)$")
  if not act then
    act, subtitle = text:match("^(Act%s+[^%s]+)%s+%-%s+(.+)$")
  end
  if not act then
    act = text
  end
  return act, subtitle
end

local function act_title_page(text)
  local act, subtitle = split_act_title(text)
  local subtitle_line = ""
  if subtitle and subtitle ~= "" then
    subtitle_line = string.format("{\\Huge\\bfseries %s \\par}\n", subtitle)
  else
    subtitle_line = string.format("{\\Huge\\bfseries %s \\par}\n", act)
  end
  local act_line = act
  if subtitle and subtitle ~= "" then
    act_line = act
  end
  return string.format([[
\clearpage
\thispagestyle{empty}
\vspace*{\stretch{1}}
\begin{center}
{\Large\scshape %s \par}
\vspace{1.2cm}
%s\end{center}
\vspace*{\stretch{2}}
\clearpage
]], act_line, subtitle_line)
end

local function is_appendix_header(el)
  if el.t == "Header" and el.level == 2 then
    local text = stringify(el.content)
    return text:match("^Appendix") ~= nil
  end
  return false
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

    if is_act_header(el) then
      local act_text = stringify(el.content)
      table.insert(blocks, pandoc.RawBlock('latex', act_title_page(act_text)))
    elseif is_appendix_header(el) and #blocks > 0 then
      table.insert(blocks, pandoc.RawBlock('latex', '\\clearpage'))
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
