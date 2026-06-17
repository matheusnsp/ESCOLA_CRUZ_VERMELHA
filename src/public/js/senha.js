// Medidor de forca de senha (apenas visual). A regra que VALE roda no servidor.
// Espelha a avaliacao da zxcvbn enquanto a pessoa digita.
(function () {
  var input = document.querySelector('input[name="senha"]');
  var caixa = document.getElementById('senhaForca');
  if (!input || !caixa) return;

  var barra = caixa.querySelector('.senha-barra > span');
  var label = caixa.querySelector('.senha-label');

  var NIVEIS = [
    { txt: 'Muito fraca', cor: '#dc2626', larg: '20%' },
    { txt: 'Fraca', cor: '#ea580c', larg: '40%' },
    { txt: 'Razoável', cor: '#ca8a04', larg: '60%' },
    { txt: 'Boa', cor: '#16a34a', larg: '80%' },
    { txt: 'Forte', cor: '#15803d', larg: '100%' },
  ];

  // Penaliza usar nome/e-mail dentro da senha (mesma logica do servidor).
  function entradasPessoais() {
    var campos = ['nome', 'email'];
    var vals = [];
    campos.forEach(function (n) {
      var el = document.querySelector('input[name="' + n + '"]');
      if (el && el.value) vals.push(el.value);
    });
    return vals;
  }

  function atualizar() {
    var val = input.value;
    if (!val) {
      caixa.hidden = true;
      return;
    }
    caixa.hidden = false;

    var score = 0;
    if (window.zxcvbn) {
      score = window.zxcvbn(val, entradasPessoais()).score; // 0..4
    } else {
      // Sem a biblioteca (offline): estimativa simples por comprimento.
      score = Math.min(4, Math.floor(val.length / 4));
    }

    var nivel = NIVEIS[score];
    barra.style.width = nivel.larg;
    barra.style.background = nivel.cor;
    label.textContent = 'Força: ' + nivel.txt + (score < 3 ? ' (mínimo recomendado: Boa)' : '');
    label.style.color = nivel.cor;
  }

  input.addEventListener('input', atualizar);
})();
