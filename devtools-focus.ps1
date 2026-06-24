# Report the currently D-pad-focused element ([data-seerrfocus]) in the Seerr TV WebView.
param([int]$Port = 18222)
$ErrorActionPreference = 'Stop'
$js = @'
(function(){var e=document.querySelector('[data-seerrfocus]');if(!e){return 'NONE @ '+location.pathname+location.search;}var r=e.getBoundingClientRect();return e.tagName+(e.id?('#'+e.id):'')+' x='+Math.round(r.left)+' y='+Math.round(r.top)+' w='+Math.round(r.width)+' href='+((e.getAttribute&&e.getAttribute('href'))||'-')+' txt='+JSON.stringify((e.textContent||'').trim().slice(0,32))+' @ '+location.pathname;})()
'@
& "$PSScriptRoot\devtools-eval.ps1" -Expr $js -Port $Port
