local function is_html_output()
  return FORMAT:match("html") ~= nil
end

local function is_simulation_target(target)
  return target and target:match("simulation%.html")
end

local function strip_simulation_inlines(inlines)
  if is_html_output() then
    return inlines
  end

  local out = pandoc.List:new()
  local i = 1

  while i <= #inlines do
    local item = inlines[i]

    if item.t == "Link" and is_simulation_target(item.target) then
      -- Drop the simulation link and the trailing " · " separator.
      i = i + 1

      if inlines[i] and inlines[i].t == "Space" and
         inlines[i + 1] and inlines[i + 1].t == "Str" and inlines[i + 1].text == "·" then
        i = i + 2
        if inlines[i] and inlines[i].t == "Space" then
          i = i + 1
        end
      end

      if #out > 0 and out[#out].t == "Space" then
        out:remove(#out)
      end
    else
      out:insert(item)
      i = i + 1
    end
  end

  return out
end

function RawBlock(el)
  if is_html_output() then
    return nil
  end

  if el.format == "html" and el.text:match("simulation%.html") then
    return {}
  end

  if FORMAT:match("latex") and (el.format == "latex" or el.format == "tex") and el.text:match("simulation%.html") then
    return {}
  end

  return nil
end

function Para(el)
  el.content = strip_simulation_inlines(el.content)
  return el
end

function Plain(el)
  el.content = strip_simulation_inlines(el.content)
  return el
end
