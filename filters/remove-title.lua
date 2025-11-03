local removed = false
local description_para = pandoc.utils.stringify(pandoc.MetaString(""))
local description_removed = false

function Meta(meta)
  if meta.description then
    description_para = pandoc.utils.stringify(meta.description)
    description_removed = false
  end
  return meta
end

function Header(el)
  if not removed and el.level == 1 then
    removed = true
    return {}
  end
end

local function normalize(str)
  return (str:gsub("%s+", " ")):gsub("^%s+", ""):gsub("%s+$", "")
end

function Para(el)
  if removed and not description_removed then
    local text = pandoc.utils.stringify(el)
    local desc = description_para or ""
    if desc == "" or normalize(text) == normalize(desc) then
      description_removed = true
      return {}
    end
  end
end
