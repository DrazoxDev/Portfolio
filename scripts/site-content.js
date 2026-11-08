const siteVariableNames = {
    background: "--background",
    text: "--text",
    primary: "--primary",
    secondary: "--secondary",
    accent: "--accent",
    border: "--border",
    shadow: "--shadow",
    editorial: "--editorial"
};

function setSiteTheme(theme) {
    const mode = document.body.classList.contains("dark-mode") ? "dark" : "light";
    const palette = theme?.[mode];
    if (!palette) return;
    Object.entries(siteVariableNames).forEach(([key, variable]) => {
        if (/^#[0-9a-f]{6}$/i.test(palette[key] ?? "")) {
            document.body.style.setProperty(variable, palette[key]);
        }
        window.addEventListener("portfolio-theme-change", () => {
            if (window.portfolioTheme) setSiteTheme(window.portfolioTheme);
        });
    });
}

function renderTraits(traits) {
    const menu = document.getElementById("menu");
    const message = document.getElementById("trait-message");
    if (!menu || !message) return;
    menu.replaceChildren();
    traits.forEach((trait, index) => {
        const link = document.createElement("a");
        link.href = "#presentation";
        link.dataset.content = String(index);
        link.setAttribute("aria-label", trait.label);
        const image = document.createElement("img");
        image.src = `/images/${trait.image}`;
        image.alt = trait.label;
        image.className = "menu-logo";
        link.appendChild(image);
        menu.appendChild(link);
    });
    const showTrait = (event) => {
        const link = event.target.closest("[data-content]");
        if (!link || !menu.contains(link)) return;
        const trait = traits[Number(link.dataset.content)];
        if (!trait) return;
        event.preventDefault();
        const paragraph = document.createElement("p");
        paragraph.textContent = trait.description;
        message.replaceChildren(paragraph);
    };
    menu.addEventListener("click", showTrait);
    const paragraph = document.createElement("p");
    paragraph.textContent = traits[0]?.description ?? "";
    message.replaceChildren(paragraph);
}

function renderSkills(skills) {
    const list = document.getElementById("skills-list");
    if (!list) return;
    list.replaceChildren(...skills.map((skill) => {
        const article = document.createElement("article");
        article.className = "competence-item skill-card";
        const eyebrow = document.createElement("span");
        eyebrow.className = "skill-index";
        eyebrow.textContent = skill.eyebrow;
        const title = document.createElement("h3");
        title.textContent = skill.title;
        const description = document.createElement("p");
        description.textContent = skill.description;
        const tools = document.createElement("ul");
        tools.className = "skill-tools";
        skill.tools.forEach((tool) => {
            const item = document.createElement("li");
            item.textContent = tool;
            tools.appendChild(item);
        });
        article.append(eyebrow, title, description, tools);
        return article;
    }));
}

function renderPortrait(items) {
    const list = document.getElementById("portrait-list");
    if (!list) return;
    list.replaceChildren(...items.map((item, index) => {
        const article = document.createElement("div");
        article.className = "portrait-item";
        const icon = document.createElement("div");
        icon.className = "portrait-icon";
        const number = document.createElement("span");
        number.setAttribute("aria-hidden", "true");
        number.textContent = String(index + 1).padStart(2, "0");
        icon.appendChild(number);
        const question = document.createElement("p");
        question.className = "portrait-question";
        question.textContent = item.question;
        const answer = document.createElement("p");
        answer.className = "portrait-answer";
        answer.textContent = item.answer;
        article.append(icon, question, answer);
        return article;
    }));
}

function renderInfluences(items) {
    const list = document.getElementById("influences-list");
    if (!list) return;
    list.replaceChildren(...items.map((item) => {
        const card = document.createElement("div");
        card.className = "influence-card";
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.setAttribute("aria-pressed", "false");
        card.setAttribute("aria-label", `Découvrir l'influence de ${item.name}`);
        const front = document.createElement("div");
        front.className = "influence-front";
        const image = document.createElement("img");
        image.src = `/images/${item.image}`;
        image.alt = item.name;
        const title = document.createElement("h3");
        title.textContent = item.name;
        front.append(image, title);
        const back = document.createElement("div");
        back.className = "influence-back";
        const description = document.createElement("p");
        description.textContent = item.description;
        back.appendChild(description);
        card.append(front, back);
        return card;
    }));
}

async function loadSiteContent() {
    try {
        const response = await fetch("/data/site.json");
        if (!response.ok) throw new Error(`Chargement des contenus impossible (${response.status}).`);
        const content = await response.json();
        window.portfolioTheme = content.theme;
        const { profile, contact } = content;
        document.querySelectorAll('[data-site="name"]').forEach((element) => {
            element.textContent = profile.name;
        });
        const values = {
            kicker: profile.kicker,
            headline: profile.headline,
            cardSubtitle: profile.cardSubtitle,
            cardFocus: profile.cardFocus,
            statement: profile.statement,
            biography: profile.biography,
            traitsCaption: profile.traitsCaption,
            phone: contact.phone,
            contactNote: contact.note
        };
        Object.entries(values).forEach(([key, value]) => {
            const element = document.querySelector(`[data-site="${key}"]`);
            if (element) {
                element.textContent = value;
                if (key === "headline") element.style.whiteSpace = "pre-line";
            }
        });
        document.querySelectorAll("[data-contact-email]").forEach((link) => {
            link.textContent = contact.email;
            link.href = `mailto:${contact.email}`;
        });
        const youtubeLink = document.querySelector("[data-contact-youtube]");
        if (youtubeLink) {
            youtubeLink.hidden = !contact.youtube;
            if (contact.youtube) youtubeLink.href = contact.youtube;
        }
        const form = document.getElementById("contact-form");
        if (form) form.action = `mailto:${contact.email}`;
        renderTraits(content.traits);
        renderSkills(content.skills);
        renderPortrait(content.portrait);
        renderInfluences(content.influences);
        setSiteTheme(content.theme);
    } catch (error) {
        console.error("Erreur lors du chargement des contenus du site :", error);
        const message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.textContent = "Les contenus du portfolio n'ont pas pu être chargés.";
        document.querySelector("main")?.prepend(message);
    }
}

loadSiteContent();
