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
