const loginPanel = document.getElementById("login-panel");
const editorPanel = document.getElementById("editor-panel");
const statusMessage = document.getElementById("admin-status");
const projectForm = document.getElementById("project-form");
const contentForm = document.getElementById("content-form");
const projectFields = ["name", "date", "category", "type", "technologies", "summary", "description"];
const contentSections = [
    ["profile", "Profil"],
    ["skills", "Compétences"],
    ["traits", "Qualités"],
    ["portrait", "Portrait chinois"],
    ["influences", "Influences"],
    ["contact", "Contact"]
];
const themeKeys = [
    ["background", "Fond de page"],
    ["text", "Texte"],
    ["primary", "Fond des cartes"],
    ["secondary", "Couleur principale"],
    ["accent", "Fond secondaire"],
    ["border", "Contours"],
    ["shadow", "Ombres"],
    ["editorial", "Accent graphique"]
];
const initialTheme = {
    light: {
        background: "#ffffff", text: "#000000", primary: "#ffffff", secondary: "#000000",
        accent: "#f0f0f0", border: "#000000", shadow: "#000000", editorial: "#000000"
    },
    dark: {
        background: "#000000", text: "#ffffff", primary: "#111111", secondary: "#ffffff",
        accent: "#222222", border: "#ffffff", shadow: "#ffffff", editorial: "#ffffff"
    }
};
let csrfToken = "";
let projects = [];
let siteContent = null;
let imageNames = [];
let selectedProject = -1;
let projectLinks = [];
let activeContentSection = "profile";

function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
}

async function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET") {
        headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Une erreur est survenue.");
    return result;
}

function renderProjects() {
    const list = document.getElementById("project-list");
    list.replaceChildren();
    projects.forEach((project, index) => {
        const item = document.createElement("li");
        item.className = "admin-project-item";
        const select = document.createElement("button");
        select.type = "button";
        select.className = "admin-project-select";
        select.textContent = project.name;
        select.setAttribute("aria-current", String(index === selectedProject));
        select.addEventListener("click", () => selectProject(index));

        const up = document.createElement("button");
        up.type = "button";
        up.className = "admin-order-button";
        up.textContent = "↑";
        up.setAttribute("aria-label", `Déplacer ${project.name} vers le haut`);
        up.disabled = index === 0;
        up.addEventListener("click", () => reorderProject(index, index - 1));

        const down = document.createElement("button");
        down.type = "button";
        down.className = "admin-order-button";
        down.textContent = "↓";
        down.setAttribute("aria-label", `Déplacer ${project.name} vers le bas`);
        down.disabled = index === projects.length - 1;
        down.addEventListener("click", () => reorderProject(index, index + 1));
        item.append(select, up, down);
        list.appendChild(item);
    });
    document.getElementById("project-count").textContent =
        `${projects.length} projet${projects.length > 1 ? "s" : ""} enregistré${projects.length > 1 ? "s" : ""}.`;
}

function textFromHtml(html) {
    const parsed = new DOMParser().parseFromString(html ?? "", "text/html");
    parsed.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith("\n"));
    parsed.querySelectorAll("a").forEach((link) => link.replaceWith("\n"));
    return parsed.body.textContent.trim();
}

function linksFromHtml(html) {
    const parsed = new DOMParser().parseFromString(html ?? "", "text/html");
    return Array.from(parsed.querySelectorAll("a[href]"), (link) => ({
        label: link.textContent.trim(),
        url: link.getAttribute("href")
    })).filter((link) => link.label && link.url);
}

function selectProject(index) {
    selectedProject = index;
    const project = projects[index];
    if (!project) return;
    const values = {
        name: project.name,
        date: project.date,
        category: project.category,
        type: project.type,
        technologies: project.technologies.join(", "),
        summary: textFromHtml(project.summaryHtml),
        description: textFromHtml(project.descriptionHtml)
    };
    projectFields.forEach((field) => {
        projectForm.elements[field].value = values[field] ?? "";
    });
    projectForm.elements.image.value = "";
    projectLinks = linksFromHtml(project.descriptionHtml);
    document.getElementById("project-form-title").textContent = "Modifier un projet";
    document.getElementById("image").required = false;
    document.getElementById("cancel-project").hidden = false;
    document.getElementById("delete-project").hidden = false;
    renderProjectLinks();
    renderProjects();
    projectForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProjectForm() {
    selectedProject = -1;
    projectLinks = [];
    projectForm.reset();
    projectForm.elements.image.required = true;
    document.getElementById("project-form-title").textContent = "Ajouter un projet";
    document.getElementById("cancel-project").hidden = true;
    document.getElementById("delete-project").hidden = true;
    renderProjectLinks();
    renderProjects();
}

function renderProjectLinks() {
    const container = document.getElementById("project-links");
    container.replaceChildren();
    projectLinks.forEach((link, index) => {
        const row = document.createElement("div");
        row.className = "admin-link-row";
        const label = createInput("Libellé", link.label, "text");
        const url = createInput("URL (https://…)", link.url, "url");
        label.input.addEventListener("input", () => { projectLinks[index].label = label.input.value; });
        url.input.addEventListener("input", () => { projectLinks[index].url = url.input.value; });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "admin-danger-button";
        remove.textContent = "Retirer";
        remove.addEventListener("click", () => {
            projectLinks.splice(index, 1);
            renderProjectLinks();
        });
        row.append(label.wrapper, url.wrapper, remove);
        container.appendChild(row);
    });
}

function createInput(labelText, value, type = "text") {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-control";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    label.appendChild(input);
    wrapper.appendChild(label);
    return { wrapper, input };
}

async function reloadProjects() {
    projects = await apiRequest("/api/admin/projects");
    renderProjects();
}

async function reorderProject(from, to) {
    try {
        await apiRequest("/api/admin/projects/reorder", {
            method: "POST",
            body: JSON.stringify({ from, to })
        });
        if (selectedProject === from) selectedProject = to;
        else if (from < selectedProject && to >= selectedProject) selectedProject -= 1;
        else if (from > selectedProject && to <= selectedProject) selectedProject += 1;
        await reloadProjects();
        showStatus("Ordre des projets mis à jour.");
    } catch (error) {
        showStatus(error.message, true);
    }
}

async function deleteProject() {
    if (selectedProject < 0 || !projects[selectedProject]) return;
    const name = projects[selectedProject].name;
    if (!window.confirm(`Supprimer « ${name} » du portfolio ? Cette action ne peut pas être annulée.`)) return;
    try {
        await apiRequest(`/api/admin/projects/${selectedProject}`, { method: "DELETE" });
        resetProjectForm();
        await reloadProjects();
        showStatus("Projet supprimé. Son fichier image est conservé.");
    } catch (error) {
        showStatus(error.message, true);
    }
}

function projectPayload(formData, imageData) {
    return {
        name: formData.get("name"),
        imageData,
        date: formData.get("date"),
        category: formData.get("category"),
        type: formData.get("type"),
        technologies: formData.get("technologies").split(",").map((item) => item.trim()).filter(Boolean),
        summary: formData.get("summary"),
        description: formData.get("description"),
        links: projectLinks
    };
}

projectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(projectForm);
    const image = projectForm.elements.image.files[0];
    if (image && image.size > 5 * 1024 * 1024) {
        showStatus("L’image doit faire moins de 5 Mo.", true);
        return;
    }
    if (!image && selectedProject < 0) {
        showStatus("Choisis une image pour ce projet.", true);
        return;
    }
    const save = async (imageData) => {
        const editing = selectedProject >= 0;
        const url = editing ? `/api/admin/projects/${selectedProject}` : "/api/admin/projects";
        try {
            await apiRequest(url, {
                method: editing ? "PUT" : "POST",
                body: JSON.stringify(projectPayload(formData, imageData))
            });
            await reloadProjects();
            if (editing) selectProject(selectedProject);
            else resetProjectForm();
            showStatus(editing ? "Projet modifié avec succès." : "Projet ajouté avec succès.");
        } catch (error) {
            showStatus(error.message, true);
        }
    };
    if (!image) {
        save(undefined);
        return;
    }
    const reader = new FileReader();
    reader.onerror = () => showStatus("Impossible de lire l’image choisie.", true);
    reader.onload = () => save(reader.result);
    reader.readAsDataURL(image);
});

document.getElementById("new-project").addEventListener("click", () => {
    resetProjectForm();
    projectForm.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("cancel-project").addEventListener("click", resetProjectForm);
document.getElementById("delete-project").addEventListener("click", deleteProject);
document.getElementById("add-project-link").addEventListener("click", () => {
    if (projectLinks.length >= 10) {
        showStatus("Un projet peut contenir au maximum 10 liens.", true);
        return;
    }
    projectLinks.push({ label: "", url: "" });
    renderProjectLinks();
});

function renderTabs() {
    const tabs = document.getElementById("content-tabs");
    tabs.replaceChildren();
    contentSections.forEach(([key, title]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `admin-tab ${key === activeContentSection ? "active" : ""}`;
        button.textContent = title;
        button.addEventListener("click", () => {
            activeContentSection = key;
            renderTabs();
            renderContentFields();
        });
        tabs.appendChild(button);
    });
}

function createField(labelText, value, path, multiline = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-control";
    const label = document.createElement("label");
    label.textContent = labelText;
    const control = multiline ? document.createElement("textarea") : document.createElement("input");
    if (!multiline) control.type = "text";
    control.value = value ?? "";
    control.dataset.path = path;
    label.appendChild(control);
    wrapper.appendChild(label);
    return wrapper;
}

const sectionFields = {
    profile: [
        ["name", "Nom affiché"],
        ["kicker", "Ligne d’introduction"],
        ["headline", "Titre principal (les retours à la ligne sont conservés)", true],
        ["cardSubtitle", "Sous-titre de la carte"],
        ["cardFocus", "Parcours"],
        ["statement", "Phrase d’accroche"],
        ["biography", "Présentation", true],
        ["traitsCaption", "Texte au-dessus des qualités"]
    ],
    contact: [
        ["email", "Adresse e-mail"],
        ["phone", "Téléphone"],
        ["note", "Texte de contact", true],
        ["youtube", "Lien YouTube"]
    ]
};

function renderRepeatedFields(group, item, index) {
    const card = document.createElement("fieldset");
    card.className = "admin-entry";
    const legend = document.createElement("legend");
    legend.textContent = `${contentSections.find(([key]) => key === group)?.[1] ?? group} ${index + 1}`;
    card.appendChild(legend);
    const fields = group === "skills"
        ? [["eyebrow", "Catégorie"], ["title", "Titre"], ["description", "Description", true], ["tools", "Technologies (séparées par des virgules)"]]
        : group === "traits"
            ? [["label", "Nom"], ["description", "Description", true], ["image", "Image"]]
            : group === "portrait"
                ? [["question", "Question"], ["answer", "Réponse", true]]
                : [["name", "Nom"], ["image", "Image"], ["description", "Description", true]];
    fields.forEach(([field, label, multiline]) => {
        if (field === "image") {
            const wrapper = document.createElement("div");
            wrapper.className = "admin-control";
            const fieldLabel = document.createElement("label");
            fieldLabel.textContent = label;
            const select = document.createElement("select");
            select.dataset.path = `${group}.${index}.${field}`;
            select.add(new Option("Choisir une image…", ""));
            imageNames.forEach((name) => select.add(new Option(name, name)));
            select.value = item.image ?? "";
            wrapper.append(fieldLabel, select);
            card.appendChild(wrapper);
            return;
        }
        const value = field === "tools" ? item.tools.join(", ") : item[field];
        card.appendChild(createField(label, value, `${group}.${index}.${field}`, multiline));
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-danger-button";
    remove.textContent = "Supprimer cette entrée";
    remove.addEventListener("click", () => {
        siteContent[group].splice(index, 1);
        renderContentFields();
    });
    card.appendChild(remove);
    return card;
}

function renderContentFields() {
    const container = document.getElementById("content-fields");
    container.replaceChildren();
    const group = activeContentSection;
    if (sectionFields[group]) {
        sectionFields[group].forEach(([field, label, multiline]) => {
            container.appendChild(createField(label, siteContent[group][field], `${group}.${field}`, multiline));
        });
        return;
    }
    siteContent[group].forEach((item, index) => {
        container.appendChild(renderRepeatedFields(group, item, index));
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "admin-secondary-button";
    add.textContent = "+ Ajouter une entrée";
    add.addEventListener("click", () => {
        const emptyEntries = {
            skills: { eyebrow: "", title: "", description: "", tools: [""] },
            traits: { label: "", description: "", image: imageNames[0] ?? "" },
            portrait: { question: "", answer: "" },
            influences: { name: "", image: imageNames[0] ?? "", description: "" }
        };
        siteContent[group].push(emptyEntries[group]);
        renderContentFields();
    });
    container.appendChild(add);
}

contentForm.addEventListener("input", (event) => updateSiteField(event.target));
contentForm.addEventListener("change", (event) => updateSiteField(event.target));
function updateSiteField(control) {
    const path = control.dataset.path;
    if (!path) return;
    const [group, indexOrField, field] = path.split(".");
    const value = field === "tools"
        ? control.value.split(",").map((item) => item.trim()).filter(Boolean)
        : control.value;
    if (field) siteContent[group][Number(indexOrField)][field] = value;
    else siteContent[group][indexOrField] = value;
}

function renderThemeFields() {
    const container = document.getElementById("theme-fields");
    container.replaceChildren();
    ["light", "dark"].forEach((mode) => {
        const group = document.createElement("fieldset");
        group.className = "admin-entry admin-color-group";
        const legend = document.createElement("legend");
        legend.textContent = mode === "light" ? "Thème clair" : "Thème sombre";
        group.appendChild(legend);
        themeKeys.forEach(([key, label]) => {
            const wrapper = document.createElement("label");
            wrapper.className = "admin-color-control";
            const text = document.createElement("span");
            text.textContent = label;
            const input = document.createElement("input");
            input.type = "color";
            input.value = siteContent.theme[mode][key];
            input.dataset.mode = mode;
            input.dataset.color = key;
            input.addEventListener("input", () => {
                siteContent.theme[mode][key] = input.value;
                if (mode === "light") document.body.style.setProperty(`--${key}`, input.value);
            });
            wrapper.append(text, input);
            group.appendChild(wrapper);
        });
        container.appendChild(group);
    });
}

function previewTheme() {
    Object.entries(siteContent.theme.light).forEach(([key, value]) => {
        document.body.style.setProperty(`--${key}`, value);
    });
}

contentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await apiRequest("/api/admin/site", {
            method: "PUT",
            body: JSON.stringify(siteContent)
        });
        showStatus("Contenus du site enregistrés.");
    } catch (error) {
        showStatus(error.message, true);
    }
});

document.getElementById("theme-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await apiRequest("/api/admin/site", {
            method: "PUT",
            body: JSON.stringify(siteContent)
        });
        showStatus("Palette de couleurs enregistrée.");
    } catch (error) {
        showStatus(error.message, true);
    }
});

document.getElementById("reset-theme").addEventListener("click", async () => {
    try {
        siteContent.theme = structuredClone(initialTheme);
        renderThemeFields();
        previewTheme();
        showStatus("Palette initiale restaurée dans l’éditeur. Enregistre pour la publier.");
    } catch (error) {
        showStatus(error.message, true);
    }
});

document.querySelectorAll(".admin-tab[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".admin-tab[data-tab]").forEach((item) => {
            item.classList.toggle("active", item === tab);
        });
        document.querySelectorAll(".admin-tab-panel").forEach((panel) => {
            panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        });
    });
});

document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    try {
        await apiRequest("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
        document.getElementById("password").value = "";
        await showEditor();
    } catch (error) {
        showStatus(error.message, true);
    }
});

async function showEditor() {
    const session = await apiRequest("/api/admin/session");
    if (!session.authenticated) return false;
    csrfToken = session.csrfToken;
    [projects, siteContent, imageNames] = await Promise.all([
        apiRequest("/api/admin/projects"),
        apiRequest("/api/admin/site"),
        apiRequest("/api/admin/images")
    ]);
    renderProjects();
    renderProjectLinks();
    renderTabs();
    renderContentFields();
    renderThemeFields();
    previewTheme();
    loginPanel.hidden = true;
    editorPanel.hidden = false;
    showStatus("");
    return true;
}

document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        await apiRequest("/api/admin/logout", { method: "POST", body: "{}" });
        csrfToken = "";
        editorPanel.hidden = true;
        loginPanel.hidden = false;
        showStatus("Déconnecté.");
    } catch (error) {
        showStatus(error.message, true);
    }
});

showEditor().catch((error) => showStatus(error.message, true));
