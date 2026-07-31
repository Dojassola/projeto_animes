import { useEffect, useState } from 'react';
import type { IntegrationSettings } from '../../../shared/contracts/media';

interface FormState {
  current: IntegrationSettings;
  apiKey: string;
  subtitlePassword: string;
  languages: string;
}

export function IntegrationSettingsPage(): React.JSX.Element {
  const [form, setForm] = useState<FormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.kitsune.integrations.get().then((result) => {
      if (result.ok) setForm({
        current: result.data,
        apiKey: '',
        subtitlePassword: '',
        languages: result.data.subtitleLanguages.join(','),
      });
      else setMessage(result.error.message);
    });
  }, []);

  async function save(): Promise<void> {
    if (form === null) return;
    const languages = form.languages.split(',').map((value) => value.trim().toLocaleLowerCase('en')).filter(Boolean);
    const result = await window.kitsune.integrations.update({
      openSubtitles: {
        username: form.current.openSubtitles.username,
        ...(form.apiKey.length > 0 ? { apiKey: form.apiKey } : {}),
        ...(form.subtitlePassword.length > 0 ? { password: form.subtitlePassword } : {}),
      },
      subtitleLanguages: languages,
    });
    if (!result.ok) setMessage(result.error.message);
    else {
      setForm({ ...form, current: result.data, apiKey: '', subtitlePassword: '' });
      setMessage('Configurações salvas com criptografia do sistema.');
    }
  }

  async function choosePath(): Promise<void> {
    const result = await window.kitsune.integrations.chooseDownloadPath();
    if (result.ok && form !== null) setForm({ ...form, current: result.data });
    else if (!result.ok) setMessage(result.error.message);
  }

  const update = (current: IntegrationSettings): void => {
    if (form !== null) setForm({ ...form, current });
  };

  return (
    <section className="page settings-page">
      <div className="page-heading"><div><span className="eyebrow">INTEGRAÇÕES</span><h1>Downloads e legendas</h1></div></div>
      {message !== null && <p className="notice" role="status">{message}</p>}
      {form !== null && (
        <>
          <div className="settings-grid">
            <section className="panel">
              <h2>Arquivos .torrent</h2>
              <p>Os arquivos do Nyaa serão salvos localmente. O aplicativo não inicia downloads automáticos.</p>
              <label>Pasta de destino<input readOnly value={form.current.torrentDownloadPath} /></label>
              <button type="button" onClick={() => void choosePath()}>Escolher pasta</button>
            </section>
            <section className="panel">
              <h2>OpenSubtitles</h2>
              <label>Chave da API<input type="password" value={form.apiKey} placeholder={form.current.openSubtitles.hasApiKey ? 'Chave já salva' : 'Obrigatória'} onChange={(event) => { setForm({ ...form, apiKey: event.currentTarget.value }); }} /></label>
              <label>Usuário (opcional)<input value={form.current.openSubtitles.username} onChange={(event) => { update({ ...form.current, openSubtitles: { ...form.current.openSubtitles, username: event.currentTarget.value } }); }} /></label>
              <label>Senha (opcional)<input type="password" value={form.subtitlePassword} placeholder={form.current.openSubtitles.hasPassword ? 'Senha já salva' : ''} onChange={(event) => { setForm({ ...form, subtitlePassword: event.currentTarget.value }); }} /></label>
              <label>Idiomas, em ordem<input value={form.languages} onChange={(event) => { setForm({ ...form, languages: event.currentTarget.value }); }} /></label>
              <small>Exemplo: pt-br,en,es. A chave é criada no perfil OpenSubtitles.</small>
            </section>
          </div>
          <button className="primary" type="button" onClick={() => void save()}>Salvar configurações</button>
        </>
      )}
    </section>
  );
}
