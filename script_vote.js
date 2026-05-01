// ─── Configuration Supabase ───────────────────────────────────────────────────
const SUPABASE_URL = 'https://bqjroqsoylnbtanhwmxg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxanJvcXNveWxuYnRhbmh3bXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1OTczOTQsImV4cCI6MjA5MDE3MzM5NH0.MIisLUmgMXmTtzH79i7j472zL3MRAbUASa4e51O_C3A';
// ⚠️  Remplace la clé ci-dessus par ta vraie anon key du projet pwhpzugyisaplmogshxk

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── ID unique du votant (navigateur/téléphone) ───────────────────────────────
// FIX: crypto.randomUUID() est plus robuste que Math.random()
let voterId = localStorage.getItem('voter_unique_id');
if (!voterId) {
  voterId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'voter_' + Math.random().toString(36).substr(2, 12);
  localStorage.setItem('voter_unique_id', voterId);
}

// ─── État global ──────────────────────────────────────────────────────────────
let candidates    = [];
let currentIndex  = 0;
let votedCategories = new Set(); // catégories déjà votées par cet utilisateur

// ─── Labels lisibles des catégories ──────────────────────────────────────────
// FIX: toutes les catégories sont couvertes (plus seulement acteur/actrice)
function categoryLabel(cat) {
  const labels = {
    actrice:            'Meilleure Actrice',
    acteur:             'Meilleur Acteur',
    meilleur_danseur:   'Meilleur Danseur',
    meilleure_danseuse: 'Meilleure Danseuse',
    meilleur_costume:   'Meilleur Costume',
  };
  return labels[cat] || cat;
}

// ─── Chargement des candidats ─────────────────────────────────────────────────
async function fetchCandidates() {
  // FIX: gestion d'erreur ajoutée
  const { data, error } = await _supabase.from('nominees').select('*').order('full_name');

  if (error) {
    console.error('Erreur chargement candidats :', error);
    document.getElementById('stack').innerHTML =
      '<p class="loading-msg" style="color:#ff6b6b">❌ Impossible de charger les candidats.<br>Vérifie ta connexion.</p>';
    return;
  }

  candidates = data || [];

  if (candidates.length === 0) {
    document.getElementById('stack').innerHTML =
      '<p class="loading-msg">Aucun candidat inscrit pour le moment.</p>';
    return;
  }

  renderStack();
  await restoreVoteStatus(); // FIX: restaure les votes déjà effectués
  fetchLeaderboard();

  // FIX: classement en temps réel via Realtime Supabase
  _supabase.channel('realtime-votes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' },
      () => fetchLeaderboard()
    )
    .subscribe();
}

// ─── Restauration du statut de vote au rechargement ───────────────────────────
// FIX: si l'utilisateur a déjà voté avant, les pilules s'affichent correctement
async function restoreVoteStatus() {
  const { data, error } = await _supabase
    .from('votes')
    .select('category, candidate_id')
    .eq('user_id', voterId);

  if (error) { console.error('Erreur restauration votes :', error); return; }

  if (data) {
    data.forEach(v => {
      votedCategories.add(v.category);
      updateStatusUI(v.category);
    });
    // Met à jour les boutons des cartes déjà affichées
    updateVoteButtons();
  }
}

// ─── Envoi d'un vote ──────────────────────────────────────────────────────────
async function sendVote(candidateNomineesId, category) {
  const btn = document.querySelector(`.card.active .btn-card-vote`);
  if (btn) btn.disabled = true;

  try {
    // Vérifie si un vote existe déjà pour cette catégorie
    const { data: existing, error: checkError } = await _supabase
      .from('votes')
      .select('id')
      .eq('category', category)
      .eq('user_id', voterId);

    if (checkError) throw checkError;

    if (existing && existing.length > 0) {
      // Met à jour le vote existant
      const { error } = await _supabase
        .from('votes')
        .update({ candidate_id: candidateNomineesId })
        .eq('category', category)
        .eq('user_id', voterId);
      if (error) throw error;
      showToast('🔄 Vote mis à jour !');
    } else {
      // Insère un nouveau vote
      const { error } = await _supabase
        .from('votes')
        .insert([{ candidate_id: candidateNomineesId, category, user_id: voterId }]);
      if (error) throw error;
      showToast('✦ Vote enregistré !');

      // Animation burst
      const card = document.querySelector('.card.active');
      if (card) {
        const burst = document.createElement('div');
        burst.className = 'burst-el';
        burst.textContent = '⭐';
        card.appendChild(burst);
        setTimeout(() => burst.remove(), 800);
      }
    }

    votedCategories.add(category);
    updateStatusUI(category);
    updateVoteButtons();
    fetchLeaderboard();

  } catch (err) {
    console.error('Erreur vote :', err);
    showToast('❌ Erreur lors du vote');
    if (btn) btn.disabled = false;
  }
}

// ─── Rendu du stack de cartes ─────────────────────────────────────────────────
// FIX: HTML correspond exactement aux classes CSS du style_final.css
function renderStack() {
  const stack = document.getElementById('stack');
  stack.innerHTML = '';

  candidates.forEach((c, index) => {
    const isActive = index === currentIndex;
    const isBehind = index === (currentIndex + 1) % candidates.length;
    const hasVoted = votedCategories.has(c.category);

    const card = document.createElement('div');
    card.className = 'card' +
      (isActive ? ' active' : '') +
      (isBehind && candidates.length > 1 ? ' behind' : '');

    // Quelques étoiles décoratives aléatoires
    const stars = Array.from({ length: 5 }, (_, i) => `
      <div class="star-dot" style="
        width:${2 + Math.random() * 3}px;
        height:${2 + Math.random() * 3}px;
        top:${Math.random() * 45}%;
        left:${10 + Math.random() * 80}%;
        --dur:${1.5 + Math.random() * 2}s;
        --delay:${Math.random() * 2}s;
      "></div>
    `).join('');

    // FIX: template complet correspondant au CSS
    card.innerHTML = `
      <div class="card-bg" style="background-image:url('${c.photo_url}')"></div>
      <div class="card-overlay"></div>
      <div class="spotlight"></div>
      ${stars}
      <div class="hint-left"><span>PASSER</span></div>
      <div class="hint-right"><span>VOTER</span></div>
      <div class="avatar-area">
        <div class="avatar-frame">
          <div class="avatar-inner">
            <img src="${c.photo_url}" alt="${c.full_name}" loading="lazy">
          </div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-role">${categoryLabel(c.category)}</div>
        <div class="card-name">${c.full_name}</div>
        <div class="name-line"></div>
        <button
          class="btn-card-vote ${hasVoted ? 'voted-yes' : ''}"
          onclick="sendVote('${c.nominees}', '${c.category}')"
          ${hasVoted ? '' : ''}
        >
          ${hasVoted ? '✅ VOTÉ' : '✦ VOTER ✦'}
        </button>
      </div>
    `;
    stack.appendChild(card);
  });

  updateDots();
}

// ─── Mise à jour des boutons après un vote ────────────────────────────────────
function updateVoteButtons() {
  document.querySelectorAll('.card').forEach((card, index) => {
    const c = candidates[index];
    if (!c) return;
    const btn = card.querySelector('.btn-card-vote');
    if (!btn) return;
    const hasVoted = votedCategories.has(c.category);
    btn.className = 'btn-card-vote' + (hasVoted ? ' voted-yes' : '');
    btn.textContent = hasVoted ? '✅ VOTÉ' : '✦ VOTER ✦';
    btn.disabled = false; // réactive le bouton (peut changer son vote)
  });
}

// ─── Navigation entre cartes ──────────────────────────────────────────────────
function navigate(dir) {
  if (candidates.length === 0) return;
  currentIndex = (currentIndex + dir + candidates.length) % candidates.length;
  renderStack();
}

// ─── Points de navigation ─────────────────────────────────────────────────────
function updateDots() {
  const dots = document.getElementById('dots');
  dots.innerHTML = candidates
    .map((_, i) => `<div class="dot ${i === currentIndex ? 'active' : ''}"></div>`)
    .join('');
}

// ─── Pilule de statut ─────────────────────────────────────────────────────────
function updateStatusUI(cat) {
  const el = document.getElementById(`status-${cat}`);
  if (el) {
    el.textContent = cat.toUpperCase().replace('_', ' ') + ' ✅';
    el.classList.add('done');
  }
}

// ─── Classement Live ──────────────────────────────────────────────────────────
// FIX: affiche la catégorie + mise à jour de l'heure
async function fetchLeaderboard() {
  const { data, error } = await _supabase.from('votes').select('candidate_id');
  if (error || !data) return;

  // Compte les votes par candidat
  const counts = {};
  data.forEach(v => { counts[v.candidate_id] = (counts[v.candidate_id] || 0) + 1; });

  // Associe aux candidats et trie par nombre de votes décroissant
  const results = candidates
    .map(c => ({ name: c.full_name, category: c.category, count: counts[c.nominees] || 0 }))
    .sort((a, b) => b.count - a.count);

  const medals = ['🥇', '🥈', '🥉'];

  document.getElementById('leaderboard-results').innerHTML = results
    .slice(0, 5)
    .map((r, i) => `
      <li>
        <span class="rank">${medals[i] || (i + 1) + '.'}</span>
        <span class="name">${r.name}</span>
        <span class="cat">${categoryLabel(r.category).split(' ').pop()}</span>
        <span class="votes">${r.count}</span>
      </li>
    `).join('');

  // Heure de dernière mise à jour
  const now = new Date();
  document.getElementById('last-updated').textContent =
    `Mis à jour à ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
}

// ─── Toast notification ───────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Lancement ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', fetchCandidates);