// Aba Certificados: a prévia (iframe) muda na hora quando a pessoa troca a opção de assinatura da sub-aba,
// antes de salvar. A rota /certificados/previa aceita ?assinatura= por cima do que está salvo.
(function () {
  var quadro = document.getElementById('previaCert');
  if (!quadro) return;
  var link = document.getElementById('previaTelaCheia');
  var modalidade = quadro.getAttribute('data-modalidade') || 'online';
  var nome = modalidade === 'presencial' ? 'assinaturaPresencial' : 'assinaturaOnline';
  var radios = document.querySelectorAll('input[type="radio"][name="' + nome + '"]');
  if (!radios.length) return;
  function atualizar() {
    var marcado = document.querySelector('input[type="radio"][name="' + nome + '"]:checked');
    if (!marcado) return;
    var url = '/certificados/previa?modalidade=' + encodeURIComponent(modalidade) + '&assinatura=' + encodeURIComponent(marcado.value);
    if (link) link.href = url;
    quadro.src = url + '&_=' + Date.now(); // o navegador não reaproveita a prévia anterior
  }
  for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', atualizar);
})();
