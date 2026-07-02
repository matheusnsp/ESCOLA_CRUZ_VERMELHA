document.addEventListener("DOMContentLoaded", () => {
    const botao = document.getElementById("btnCopiar");
    if (!botao) return; // página sem PIX, não faz nada
  
    botao.addEventListener("click", copiarPix);
  });
  
  function copiarPix() {
    const texto = document.getElementById("chavePix").value;
    const botao = document.getElementById("btnCopiar");
  
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto)
        .then(() => mostrarCopiado(botao))
        .catch(() => copiarAntigo(texto, botao));
    } else {
      copiarAntigo(texto, botao);
    }
  }
  
  function copiarAntigo(texto, botao) {
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    try {
      document.execCommand("copy");
      mostrarCopiado(botao);
    } catch (e) {
      alert("Não foi possível copiar. Selecione o código manualmente.");
    }
    document.body.removeChild(area);
  }
  
  function mostrarCopiado(botao) {
    botao.innerHTML = "✅ Copiado!";
    setTimeout(() => {
      botao.innerHTML = "Copiar código PIX";
    }, 2000);
  }