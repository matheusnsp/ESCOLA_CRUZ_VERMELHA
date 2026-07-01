// Mascaras de digitacao (celular, CPF/CNPJ, RG). So formatacao visual —
// quem valida e normaliza de verdade e sempre o SERVIDOR.
(function () {
  function soDigitos(v) {
    return (v || '').replace(/\D/g, '');
  }

  // Preenche um padrao tipo "##.###.###-##" com os digitos, na ordem.
  function aplicarPadrao(digitos, padrao) {
    var resultado = '';
    var di = 0;
    for (var i = 0; i < padrao.length && di < digitos.length; i++) {
      if (padrao[i] === '#') {
        resultado += digitos[di];
        di++;
      } else {
        resultado += padrao[i];
      }
    }
    return resultado;
  }

  // Celular: 10 digitos -> (00) 0000-0000 | 11 digitos -> (00) 00000-0000
  function mascararCelular(valor) {
    var d = soDigitos(valor).slice(0, 11);
    var padrao = d.length > 10 ? '(##) #####-####' : '(##) ####-####';
    return aplicarPadrao(d, padrao);
  }

  // CPF/CNPJ no mesmo campo: ate 11 digitos vira CPF, a partir do 12º vira CNPJ.
  function mascararCpfCnpj(valor) {
    var d = soDigitos(valor).slice(0, 14);
    if (d.length > 11) return aplicarPadrao(d, '##.###.###/####-##');
    return aplicarPadrao(d, '###.###.###-##');
  }

  // RG: formato mais comum (00.000.000-0). Aceita uma letra no final (ex.: dígito "X"),
  // já que RG não segue um padrão único nacional — isso é só uma ajuda visual.
  function mascararRG(valor) {
    var bruto = (valor || '').toUpperCase();
    var letraFinal = '';
    if (/[A-Z]$/.test(bruto)) {
      letraFinal = bruto.slice(-1);
      bruto = bruto.slice(0, -1);
    }
    var d = soDigitos(bruto).slice(0, 8);
    var partes = [];
    if (d.length > 0) partes.push(d.slice(0, 2));
    if (d.length > 2) partes.push(d.slice(2, 5));
    if (d.length > 5) partes.push(d.slice(5, 8));
    var resultado = partes.join('.');
    if (letraFinal) resultado += (resultado ? '-' : '') + letraFinal;
    return resultado;
  }

  function conectar(seletor, fn) {
    document.querySelectorAll(seletor).forEach(function (el) {
      if (el.value) el.value = fn(el.value); // formata o valor que já veio preenchido
      el.addEventListener('input', function () {
        var pos = el.selectionStart;
        var tamanhoAntes = el.value.length;
        el.value = fn(el.value);
        var diff = el.value.length - tamanhoAntes;
        // Mantem o cursor perto de onde a pessoa estava digitando.
        if (pos != null) el.setSelectionRange(pos + diff, pos + diff);
      });
    });
  }

  conectar('[data-mask="celular"]', mascararCelular);
  conectar('[data-mask="cpfCnpj"]', mascararCpfCnpj);
  conectar('[data-mask="rg"]', mascararRG);
})();
