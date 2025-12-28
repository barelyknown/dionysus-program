local function stringify(el)
  return pandoc.utils.stringify(el)
end

function Header(el)
  if el.level == 2 then
    local text = stringify(el.content)
    if text:match("^Act ") then
      table.insert(el.classes, "act-title")
    end
  end
  return el
end
