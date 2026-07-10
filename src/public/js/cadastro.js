// Seletor CPF/CNPJ/Passaporte no cadastro: os campos só aparecem após escolher o tipo.
(function () {
  var botoes = document.querySelectorAll('.tp-btn');
  if (!botoes.length) return;

  var campoDoc = document.getElementById('campo-documento');
  var campoRg = document.getElementById('campo-rg');
  var campoPassaporte = document.getElementById('campo-passaporte');
  var campoPaisOrigem = document.getElementById('campo-pais-origem');
  var inputDoc = campoDoc ? campoDoc.querySelector('input') : null;
  var inputRg = campoRg ? campoRg.querySelector('input') : null;
  var inputPassaporte = campoPassaporte ? campoPassaporte.querySelector('input') : null;
  var inputPaisOrigem = campoPaisOrigem ? campoPaisOrigem.querySelector('input') : null;
  var labelDoc = document.getElementById('label-documento');
  var hint = document.getElementById('tipo-hint');
  var inputTipo = document.getElementById('tipoDocumentoInput');

  function aplicar(tipo) {
    botoes.forEach(function (b) { b.classList.toggle('ativo', b.dataset.tipo === tipo); });
    if (hint) hint.style.display = 'none';
    if (inputTipo) inputTipo.value = tipo;

    if (tipo === 'PASSAPORTE') {
      if (campoDoc) campoDoc.style.display = 'none';
      if (inputDoc) { inputDoc.required = false; inputDoc.value = ''; }
      if (campoRg) campoRg.style.display = 'none';
      if (inputRg) { inputRg.required = false; inputRg.value = ''; }
      if (campoPassaporte) campoPassaporte.style.display = '';
      if (inputPassaporte) inputPassaporte.required = true;
      if (campoPaisOrigem) campoPaisOrigem.style.display = '';
      if (inputPaisOrigem) inputPaisOrigem.required = true;
      return;
    }

    if (campoPassaporte) campoPassaporte.style.display = 'none';
    if (inputPassaporte) { inputPassaporte.required = false; inputPassaporte.value = ''; }
    if (campoPaisOrigem) campoPaisOrigem.style.display = 'none';
    if (inputPaisOrigem) { inputPaisOrigem.required = false; inputPaisOrigem.value = ''; }

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
      if (inputRg) inputRg.required = false;
    }
  }

  botoes.forEach(function (b) {
    b.addEventListener('click', function () { aplicar(b.dataset.tipo); });
  });

  // Se voltou de um erro de validação com algo já preenchido, reabre no tipo certo.
  var docVal = (inputDoc && inputDoc.value ? inputDoc.value : '').replace(/\D/g, '');
  var rgVal = inputRg && inputRg.value ? inputRg.value : '';
  var passaporteVal = inputPassaporte && inputPassaporte.value ? inputPassaporte.value : '';
  var tipoSalvo = inputTipo && inputTipo.value ? inputTipo.value : '';

  if (tipoSalvo === 'PASSAPORTE' || passaporteVal) aplicar('PASSAPORTE');
  else if (docVal.length === 14) aplicar('CNPJ');
  else if (docVal.length === 11 || rgVal) aplicar('CPF');
  // senão, mantém tudo escondido até o usuário escolher.
})();