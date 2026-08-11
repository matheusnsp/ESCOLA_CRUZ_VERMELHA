// Seletor CPF/CNPJ/Passaporte no cadastro: os campos só aparecem após escolher o tipo.
(function () {
  var botoes = document.querySelectorAll('.tp-btn');
  if (!botoes.length) return;

  var campoDoc        = document.getElementById('campo-documento');
  var campoRg         = document.getElementById('campo-rg');
  var campoPassaporte = document.getElementById('campo-passaporte');
  var campoPaisOrigem = document.getElementById('campo-pais-origem');

  var inputDoc        = campoDoc        ? campoDoc.querySelector('input')        : null;
  var inputRg         = campoRg         ? campoRg.querySelector('input')         : null;
  var inputPassaporte = campoPassaporte ? campoPassaporte.querySelector('input') : null;
  var inputPaisOrigem = campoPaisOrigem ? campoPaisOrigem.querySelector('input') : null;

  var labelDoc  = document.getElementById('label-documento');
  var hint      = document.getElementById('tipo-hint');
  var inputTipo = document.getElementById('tipoDocumentoInput');

  // Mostra/esconde pelo atributo nativo `hidden` em vez de style.display.
  // O CSS tem [hidden] { display: none !important }, então isso funciona
  // mesmo com .auth-field { display: block }.
  function ver(campo, visivel) {
    if (campo) campo.hidden = !visivel;
  }

  // Campo escondido não pode continuar `required`: o navegador bloquearia
  // o envio apontando para um campo que a pessoa nem enxerga.
  function exigir(input, obrigatorio, limpar) {
    if (!input) return;
    input.required = obrigatorio;
    if (limpar) input.value = '';
  }

  function aplicar(tipo) {
    botoes.forEach(function (b) { b.classList.toggle('ativo', b.dataset.tipo === tipo); });
    ver(hint, false);
    if (inputTipo) inputTipo.value = tipo;

    if (tipo === 'PASSAPORTE') {
      ver(campoDoc, false);        exigir(inputDoc, false, true);
      ver(campoRg, false);         exigir(inputRg, false, true);
      ver(campoPassaporte, true);  exigir(inputPassaporte, true);
      ver(campoPaisOrigem, true);  exigir(inputPaisOrigem, true);
      return;
    }

    ver(campoPassaporte, false); exigir(inputPassaporte, false, true);
    ver(campoPaisOrigem, false); exigir(inputPaisOrigem, false, true);

    ver(campoDoc, true);
    exigir(inputDoc, true);

    if (tipo === 'CNPJ') {
      if (labelDoc) labelDoc.textContent = 'CNPJ';
      if (inputDoc) inputDoc.placeholder = '00.000.000/0000-00';
      ver(campoRg, false);
      exigir(inputRg, false, true);
    } else {
      if (labelDoc) labelDoc.textContent = 'CPF';
      if (inputDoc) inputDoc.placeholder = '000.000.000-00';
      ver(campoRg, true);
      exigir(inputRg, false); // RG é opcional para CPF
    }
  }

  botoes.forEach(function (b) {
    b.addEventListener('click', function () { aplicar(b.dataset.tipo); });
  });

  // Se voltou de um erro de validação com algo já preenchido, reabre no tipo certo.
  var docVal        = (inputDoc && inputDoc.value ? inputDoc.value : '').replace(/\D/g, '');
  var rgVal         = inputRg && inputRg.value ? inputRg.value : '';
  var passaporteVal = inputPassaporte && inputPassaporte.value ? inputPassaporte.value : '';
  var tipoSalvo     = inputTipo && inputTipo.value ? inputTipo.value : '';

  if (tipoSalvo === 'PASSAPORTE' || passaporteVal) aplicar('PASSAPORTE');
  else if (tipoSalvo === 'CNPJ' || docVal.length === 14) aplicar('CNPJ');
  else if (tipoSalvo === 'CPF' || docVal.length === 11 || rgVal) aplicar('CPF');
  // senão, mantém tudo escondido até o usuário escolher.
})();