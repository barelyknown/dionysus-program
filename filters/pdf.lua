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

    if (is_act_header(el) or is_appendix_header(el)) and #blocks > 0 then
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
