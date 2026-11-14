const form = document.querySelector('#check');
const message = document.querySelector('#message');
const result = document.querySelector('#result');
const value = (selector, text) => { document.querySelector(selector).textContent = text; };
form.addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.querySelector('#name').value.trim();
  if (!name) return;
  const button = form.querySelector('button'); button.disabled = true; result.hidden = true; message.textContent = 'Checking…';
  try {
    const response = await fetch('/v1/check?' + new URLSearchParams({ name, ecosystem: 'npm' }));
    const data = await response.json();
    const assessment = data.assessment ?? (response.ok ? data : null);
    if (!assessment) throw new Error(data.error?.message ?? 'The check failed.');
    message.textContent = response.ok ? '' : data.error.message;
    value('#score', assessment.riskScore === null ? 'Score unavailable' : `Heuristic risk: ${assessment.riskScore} / 1`);
    value('#summary', `Status: ${assessment.status}. Existence: ${assessment.exists === null ? 'unknown' : assessment.exists ? 'found' : 'not found'}.`);
    const details = document.querySelector('#details'); details.replaceChildren();
    const rows = [['Coverage', `${assessment.corpus.coverage}: ${assessment.corpus.description} (${assessment.corpus.version})`], ['Input downloads', `${assessment.subject.downloads ?? 'unknown'} (${assessment.window.start} to ${assessment.window.end})`], ['Input freshness', `Observed ${assessment.subject.observedAt}; expires ${assessment.subject.expiresAt} (${Date.parse(assessment.subject.expiresAt) <= Date.now() ? 'stale' : 'fresh'})`], ['Model', assessment.modelVersion], ['Reasons', assessment.reasonCodes.join(', ') || 'none'], ['Slopsquatting', assessment.slopsquattingAssessment]];
    for (const [label, text] of rows) { const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = text; details.append(dt, dd); }
    const body = document.querySelector('#alternatives'); body.replaceChildren();
    for (const alt of assessment.alternatives) { const tr = document.createElement('tr'); for (const cell of [alt.name, alt.downloads, alt.similarity, alt.distance, alt.riskScore]) { const td = document.createElement('td'); td.textContent = String(cell); tr.append(td); } body.append(tr); }
    document.querySelector('#empty').hidden = assessment.alternatives.length > 0;
    value('#json', JSON.stringify(assessment, null, 2)); result.hidden = false;
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'The check failed.'; }
  finally { button.disabled = false; }
});
