// Medidor de forca + checklist de requisitos (apenas visual).
// A regra que VALE roda no servidor. Aqui so espelhamos, pra pessoa
// saber o que falta enquanto digita.
//
// A checklist ja aparece inteira desde o inicio, com X em tudo. Cada
// item vira ✓ assim que a regra correspondente e atendida.
//
// Generico: funciona em qualquer input de senha. Basta que o .senha-forca
// e/ou a .senha-checklist estejam dentro do mesmo <label> do input.
(function () {
  var NIVEIS = [
    { txt: 'Muito fraca', cor: '#dc2626', larg: '20%' },
    { txt: 'Fraca', cor: '#ea580c', larg: '40%' },
    { txt: 'Razoável', cor: '#ca8a04', larg: '60%' },
    { txt: 'Boa', cor: '#16a34a', larg: '80%' },
    { txt: 'Forte', cor: '#15803d', larg: '100%' },
  ];

  var COR_CURTA = '#dc2626';
  var PONTUACAO_MINIMA = 3; // espelha o PONTUACAO_MINIMA do servidor

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

  // Heuristica local so pro feedback: pedaco de 3+ letras do nome/e-mail
  // aparecendo na senha. O veredito real e do zxcvbn no servidor.
  function contemPessoal(senha, entradas) {
    var s = senha.toLowerCase();
    return entradas.some(function (v) {
      return String(v)
        .toLowerCase()
        .split(/[\s@._\-+]+/)
        .some(function (p) {
          return p.length >= 3 && s.indexOf(p) !== -1;
        });
    });
  }

  // Dois estados apenas: 'erro' (X) e 'ok' (✓). Nada fica neutro —
  // a pessoa ve a lista completa do que falta antes de comecar a digitar.
  function marcar(item, atendido) {
    if (!item) return;
    item.dataset.estado = atendido ? 'ok' : 'erro';
    var icone = item.querySelector('i');
    if (icone) {
      icone.className = atendido ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark';
    }
  }

    // ── Botao "ver senha" ───────────────────────────────────────
  // Injetado por JS em todo input[type=password] do site. Assim nenhuma
  // view precisa saber que ele existe, e telas novas ganham o recurso
  // de graca. Sem JS, o campo continua funcionando normalmente.
  function montarOlho(input) {
    if (input.dataset.olho) return; // ja tem
    input.dataset.olho = '1';

    var caixa = document.createElement('div');
    caixa.className = 'senha-campo';
    input.parentNode.insertBefore(caixa, input);
    caixa.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button'; // sem isso, vira submit dentro do <form>
    btn.className = 'senha-olho';
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
    caixa.appendChild(btn);

    btn.addEventListener('click', function () {
      var mostrando = input.type === 'text';
      input.type = mostrando ? 'password' : 'text';
      btn.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
      btn.setAttribute('aria-pressed', mostrando ? 'false' : 'true');
      btn.innerHTML = mostrando
        ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
      // Devolve o cursor pro fim do texto, senao ele pula pro comeco.
      input.focus();
      var fim = input.value.length;
      try { input.setSelectionRange(fim, fim); } catch (e) {}
    });
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('input[type="password"]'),
    montarOlho
  );

  var inputs = document.querySelectorAll('input[type="password"]');

  Array.prototype.forEach.call(inputs, function (input) {
    var label = input.closest('label');
    if (!label) return;

    var caixa = label.querySelector('.senha-forca');
    var lista = label.querySelector('.senha-checklist');
    if (!caixa && !lista) return;

    var barra = caixa ? caixa.querySelector('.senha-barra > span') : null;
    var textoLabel = caixa ? caixa.querySelector('.senha-label') : null;
    var minChars = parseInt(input.getAttribute('minlength') || '0', 10);

    var itens = {};
    if (lista) {
      Array.prototype.forEach.call(lista.querySelectorAll('[data-regra]'), function (li) {
        itens[li.dataset.regra] = li;
      });
      var alvoMin = lista.querySelector('.min-chars');
      if (alvoMin && minChars) alvoMin.textContent = minChars;
    }

    // Campo de confirmacao: precisa olhar a senha principal.
    var principal = null;
    if (itens.igual) {
      var todos = (input.form || document).querySelectorAll('input[type="password"]');
      principal = Array.prototype.filter.call(todos, function (i) {
        return i !== input;
      })[0] || null;
    }

    function atualizar() {
      var val = input.value;
      var entradas = entradasPessoais();
      var score = null;

      if (val) {
        if (window.zxcvbn) {
          score = window.zxcvbn(val, entradas).score; // 0..4
        } else {
          // Sem a biblioteca (offline): estimativa simples por comprimento.
          score = Math.min(4, Math.floor(val.length / 4));
        }
      }

      // --- checklist ---
      if (itens.tamanho) {
        marcar(itens.tamanho, minChars > 0 && val.length >= minChars);
      }

      if (itens.forca) {
        marcar(itens.forca, !!val && score >= PONTUACAO_MINIMA);
      }

      if (itens.pessoal) {
        // Se a pagina nao tem nome/e-mail no DOM, nao ha o que comparar.
        itens.pessoal.hidden = !entradas.length;
        if (entradas.length) {
          marcar(itens.pessoal, !!val && !contemPessoal(val, entradas));
        }
      }

      if (itens.igual && principal) {
        marcar(itens.igual, !!val && val === principal.value);
      }

      // --- barra de forca ---
      if (!caixa) return;

      if (!val) {
        caixa.hidden = true;
        return;
      }
      caixa.hidden = false;

      if (minChars && val.length < minChars) {
        var faltam = minChars - val.length;
        barra.style.width = '100%';
        barra.style.background = COR_CURTA;
        textoLabel.textContent =
          'Faltam ' + faltam + ' caractere' + (faltam > 1 ? 's' : '') + ' (mínimo de ' + minChars + ').';
        textoLabel.style.color = COR_CURTA;
        return;
      }

      var nivel = NIVEIS[score];
      barra.style.width = nivel.larg;
      barra.style.background = nivel.cor;
      textoLabel.textContent = 'Força: ' + nivel.txt + (score < PONTUACAO_MINIMA ? ' (mínimo: Boa)' : '');
      textoLabel.style.color = nivel.cor;
    }

    input.addEventListener('input', atualizar);
    // Confirmacao precisa reagir quando a senha principal muda tambem.
    if (principal) principal.addEventListener('input', atualizar);

    atualizar();
  });
})();