// Seletor CPF/CNPJ no cadastro: os campos só aparecem após escolher o tipo.
(function () {
  var botoes = document.querySelectorAll('.tp-btn');
  if (!botoes.length) return;

  var campoDoc = document.getElementById('campo-documento');
  var campoRg = document.getElementById('campo-rg');
  var inputDoc = campoDoc ? campoDoc.querySelector('input') : null;
  var inputRg = campoRg ? campoRg.querySelector('input') : null;
  var labelDoc = document.getElementById('label-documento');
  var hint = document.getElementById('tipo-hint');

  function aplicar(tipo) {
    botoes.forEach(function (b) { b.classList.toggle('ativo', b.dataset.tipo === tipo); });
    if (hint) hint.style.display = 'none';
    if (campoDoc) campoDoc.style.display = '';
    if (inputDoc) inputDoc.required = true;

    if (tipo === 'CNPJ') {
      if (labelDoc) labelDoc.textContent = 'CNPJ';
      if (inputDoc) inputDoc.placeholder = '00.000.000/0000-00';
      if (campoRg) campoRg.style.display = 'none';
      if (inputRg) { inputRg.required = false; inputRg.value = ''; }
    } else {
      if (labelDoc) labelDoc.textContent = 'CPF';
      if (inputDoc) inputDoc.placeholder = '000.000.000-00';
      if (campoRg) campoRg.style.display = '';
      if (inputRg) inputRg.required = true;
    }
  }

  botoes.forEach(function (b) {
    b.addEventListener('click', function () { aplicar(b.dataset.tipo); });
  });

  // Se voltou de um erro de validação com algo já preenchido, reabre no tipo certo.
  var docVal = (inputDoc && inputDoc.value ? inputDoc.value : '').replace(/\D/g, '');
  var rgVal = inputRg && inputRg.value ? inputRg.value : '';
  if (docVal.length === 14) aplicar('CNPJ');
  else if (docVal.length === 11 || rgVal) aplicar('CPF');
  // senão, mantém tudo escondido até o usuário escolher.
})();
