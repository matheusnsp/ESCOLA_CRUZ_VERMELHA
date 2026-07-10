// Mascaras de digitacao (celular, CPF/CNPJ, RG, passaporte). So formatacao visual —
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
  // 💡 CORRIGIDO: RG no formato "12.345.678-9" — 8 dígitos + 1 dígito verificador (9 no
  // total), com o traço separando só o último. A versão anterior cortava em 8 dígitos e só
  // colocava o traço se a pessoa digitasse uma LETRA no final (ex.: "X" de alguns RGs de SP) —
  // com isso, o 9º dígito (o verificador numérico, que é o formato pedido) nunca aparecia e o
  // traço nunca era mostrado quando a pessoa só digitava números. Isso também bate com o
  // validation.js do servidor, que exige exatamente \d{2}\.\d{3}\.\d{3}-\d (dígito no final,
  // não letra) — antes as duas coisas estavam desalinhadas.
  function mascararRG(valor) {
  var d = soDigitos(valor).slice(0, 9);
  var partes = [];
  if (d.length > 0) partes.push(d.slice(0, 2));
  if (d.length > 2) partes.push(d.slice(2, 5));
  if (d.length > 5) partes.push(d.slice(5, 8));
  var resultado = partes.join('.');
  if (d.length > 8) resultado += '-' + d.slice(8, 9);
  return resultado;
    }
  // Passaporte brasileiro: serie de 2 letras + 6 digitos numericos, ex: AA123456.
  // As 2 primeiras posicoes so aceitam letra (forcada maiuscula); as 6 seguintes
  // so aceitam numero. Qualquer caractere fora do padrao esperado na posicao e ignorado.
  function mascararPassaporte(valor) {
  var v = (valor || '').toUpperCase();
  var apenasValidos = v.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  var resultado = '';
  for (var i = 0; i < apenasValidos.length; i++) {
  var c = apenasValidos[i];
  if (i < 2) {
  if (/[A-Z]/.test(c)) resultado += c;
        } else {
  if (/[0-9]/.test(c)) resultado += c;
        }
      }
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
  conectar('[data-mask="passaporte"]', mascararPassaporte);
  })();