// Medidor de forca de senha (apenas visual). A regra que VALE roda no servidor.
// Espelha a avaliacao da zxcvbn enquanto a pessoa digita.
//
// Genérico: funciona em qualquer input de senha, independente do atributo
// "name" (ex: "senha" em redefinir-senha, "novaSenha" em minha-conta).
// Basta que o .senha-forca esteja dentro do mesmo <label> do input.
//
// O aviso de "mínimo de N caracteres" não fica fixo na tela — só aparece
// dinamicamente aqui enquanto a senha digitada ainda for curta demais.
(function () {
  var caixas = document.querySelectorAll('.senha-forca');
  if (!caixas.length) return;

  var NIVEIS = [
    { txt: 'Muito fraca', cor: '#dc2626', larg: '20%' },
    { txt: 'Fraca', cor: '#ea580c', larg: '40%' },
    { txt: 'Razoável', cor: '#ca8a04', larg: '60%' },
    { txt: 'Boa', cor: '#16a34a', larg: '80%' },
    { txt: 'Forte', cor: '#15803d', larg: '100%' },
  ];

  var COR_CURTA = '#dc2626';

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

  caixas.forEach(function (caixa) {
    var label = caixa.closest('label');
    var input = label ? label.querySelector('input[type="password"]') : null;
    if (!input) return;

    var barra = caixa.querySelector('.senha-barra > span');
    var textoLabel = caixa.querySelector('.senha-label');
    var minChars = parseInt(input.getAttribute('minlength') || '0', 10);

    function atualizar() {
      var val = input.value;
      if (!val) {
        caixa.hidden = true;
        return;
      }
      caixa.hidden = false;

      // Ainda mais curta que o mínimo: avisa isso primeiro, sem calcular
      // força ainda (não faz sentido avaliar força de uma senha incompleta).
      if (minChars && val.length < minChars) {
        var faltam = minChars - val.length;
        barra.style.width = '100%';
        barra.style.background = COR_CURTA;
        textoLabel.textContent = 'Faltam ' + faltam + ' caractere' + (faltam > 1 ? 's' : '') + ' (mínimo de ' + minChars + ').';
        textoLabel.style.color = COR_CURTA;
        return;
      }

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
      textoLabel.textContent = 'Força: ' + nivel.txt + (score < 3 ? ' (mínimo recomendado: Boa)' : '');
      textoLabel.style.color = nivel.cor;
    }

    input.addEventListener('input', atualizar);
  });
})();