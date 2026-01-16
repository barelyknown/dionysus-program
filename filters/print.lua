local function stringify(el)
  return pandoc.utils.stringify(el)
end

local middle_dot = string.char(194, 183)
local in_index = false

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

local function inline_to_latex(inlines)
  local doc = pandoc.Pandoc({pandoc.Plain(inlines)})
  local latex = pandoc.write(doc, "latex")
  return latex:gsub("%s+$", "")
end

local function is_print_link(el)
  if el.t ~= "Link" then
    return false
  end
  local text = stringify(el.content)
  return text == "Free" or text == "Amazon" or text == "Historical Cases"
end

local function strip_print_links(inlines)
  if not FORMAT:match("latex") then
    return inlines
  end

  local out = pandoc.List:new()
  local i = 1

  while i <= #inlines do
    local item = inlines[i]

    if in_index and item.t == "Link" then
      local target = item.target or ""
      local text_latex = inline_to_latex(item.content)
      if target:match("^#") then
        local label = target:gsub("^#", "")
        out:insert(pandoc.RawInline("latex", string.format("%s, p.~\\pageref{\\detokenize{%s}}", text_latex, label)))
      else
        out:insert(pandoc.RawInline("latex", text_latex))
      end
      i = i + 1
    elseif is_print_link(item) then
      -- Drop the link and any surrounding separators like " : " or " middle dot ".
      i = i + 1

      if inlines[i] and inlines[i].t == "Space" then
        local next_item = inlines[i + 1]
        if next_item and next_item.t == "Str" and (next_item.text == middle_dot or next_item.text == ":") then
          i = i + 2
          if inlines[i] and inlines[i].t == "Space" then
            i = i + 1
          end
        end
      end

      if #out >= 2 then
        local prev = out[#out]
        local prev2 = out[#out - 1]
        if prev.t == "Space" and prev2.t == "Str" and (prev2.text == middle_dot or prev2.text == ":") then
          out:remove(#out)
          out:remove(#out)
          if #out > 0 and out[#out].t == "Space" then
            out:remove(#out)
          end
        end
      end
    elseif item then
      out:insert(item)
      i = i + 1
    end
  end

  if #out > 0 and out[#out].t == "Space" then
    out:remove(#out)
  end

  return out
end

function Para(el)
  el.content = strip_print_links(el.content)
  return el
end

function Plain(el)
  el.content = strip_print_links(el.content)
  return el
end

function Header(el)
  if not FORMAT:match("latex") then
    return el
  end
  if el.level == 2 then
    local id = header_identifier(el)
    if id == "appendix-e-index" then
      in_index = true
    elseif in_index then
      in_index = false
    end
  end
  return el
end
