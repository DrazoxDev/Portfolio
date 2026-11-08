const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PROJECTS_FILE = path.join(ROOT, "data", "projets.json");
const SITE_FILE = path.join(ROOT, "data", "site.json");
const IMAGE_DIRECTORY = path.join(ROOT, "images");
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const SITE_URL = parseSiteUrl(process.env.SITE_URL ?? "");
const SESSION_COOKIE = "portfolio_admin";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

const passwordHash = process.env.ADMIN_PASSWORD_HASH ?? "";
const sessionSecret = process.env.SESSION_SECRET ?? "";
const [passwordSalt, passwordDigest] = passwordHash.split(":");

if (!passwordSalt || !passwordDigest || !/^[a-f0-9]{32,}$/i.test(passwordSalt)
    || !/^[a-f0-9]{128}$/i.test(passwordDigest)) {
    throw new Error("ADMIN_PASSWORD_HASH is missing or invalid. Generate one with server/create-admin-hash.js.");
}
if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port.");
}

const expectedPasswordDigest = Buffer.from(passwordDigest, "hex");
const sessions = new Map();
const loginAttempts = new Map();
let writeQueue = Promise.resolve();

function sendJson(response, status, payload, headers = {}) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers
    });
    response.end(JSON.stringify(payload));
}

function parseCookies(header = "") {
    return Object.fromEntries(header.split(";").map((part) => {
        const separator = part.indexOf("=");
        return separator === -1
            ? ["", ""]
            : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }).filter(([name]) => name));
}

function cookieOptions(maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function getSession(request) {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!sessionId) return null;

    const expiresAt = sessions.get(sessionId);
    if (!expiresAt || expiresAt <= Date.now()) {
        sessions.delete(sessionId);
        return null;
    }
    return sessionId;
}

function csrfToken(sessionId) {
    return crypto.createHmac("sha256", sessionSecret).update(`csrf:${sessionId}`).digest("hex");
}

function hasValidCsrf(request, sessionId) {
    const supplied = request.headers["x-csrf-token"];
    if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(csrfToken(sessionId), "hex"));
}

function hasSameOrigin(request) {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || typeof request.headers.host !== "string") return false;
    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

async function readJson(request) {
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        const error = new Error("Content-Type must be application/json.");
        error.status = 415;
        throw error;
    }

    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length > MAX_REQUEST_BYTES) {
            const error = new Error("Request body is too large.");
            error.status = 413;
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        const error = new Error("Request body must contain valid JSON.");
        error.status = 400;
        throw error;
    }
}

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function parseSiteUrl(value) {
    if (!value.trim()) return "";
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error("SITE_URL must be a valid HTTPS origin, for example https://portfolio.example.");
    }
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        throw new Error("SITE_URL must be an HTTPS origin without a path, query, or credentials.");
    }
    return url.origin;
}

function slugifyProjectName(name) {
    return name.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "projet";
}

function projectSlug(project) {
    return typeof project.slug === "string" && /^[a-z0-9-]+$/.test(project.slug)
        ? project.slug
        : slugifyProjectName(project.name);
}

function assertUniqueProjectSlug(projects, project, ignoredIndex = -1) {
    const slug = projectSlug(project);
    if (projects.some((existing, index) => index !== ignoredIndex && projectSlug(existing) === slug)) {
        const error = new Error("A project with the same URL slug already exists. Choose a different name.");
        error.status = 409;
        throw error;
    }
}

function plainText(html) {
    return html
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function metaDescription(text) {
    if (text.length <= 160) return text;
    const shortened = text.slice(0, 159);
    const lastSpace = shortened.lastIndexOf(" ");
    return `${shortened.slice(0, lastSpace > 120 ? lastSpace : 159).trimEnd()}…`;
}

function xmlEscape(value) {
    return String(value).replace(/[<>&'"]/g, (character) => ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;"
    })[character]);
}

function setMetaContent(html, id, value) {
    const escaped = escapeHtml(value);
    const tagPattern = new RegExp(`<(?:(?:meta)|(?:link))\\b[^>]*\\bid="${id}"[^>]*>`, "i");
    return html.replace(tagPattern, (tag) => {
        const attribute = /<link\b/i.test(tag) ? "href" : "content";
        const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`, "i");
        return tag.replace(attributePattern, () => `${attribute}="${escaped}"`);
    });
}

function replaceElementContents(html, id, content) {
    const openingPattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>)`, "i");
    const openingMatch = openingPattern.exec(html);
    if (!openingMatch) return html;

    const openingEnd = openingMatch.index + openingMatch[1].length;
    const tagPattern = new RegExp(`<\\/?${openingMatch[2]}\\b[^>]*>`, "gi");
    tagPattern.lastIndex = openingEnd;
    let depth = 1;
    let tagMatch;

    while ((tagMatch = tagPattern.exec(html))) {
        if (/^<\//.test(tagMatch[0])) {
            depth -= 1;
            if (depth === 0) {
                return `${html.slice(0, openingEnd)}${content}${html.slice(tagMatch.index)}`;
            }
        } else if (!/\/\s*>$/.test(tagMatch[0])) {
            depth += 1;
        }
    }

    return html;
}

function replaceDataSiteContents(html, key, content) {
    const pattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bdata-site="${key}"[^>]*>)[\\s\\S]*?(<\\/\\2\\s*>)`, "gi");
    return html.replace(pattern, (match, opening, tagName, closing) => `${opening}${content}${closing}`);
}

function setElementAttribute(html, id, attribute, value) {
    const tagPattern = new RegExp(`(<[a-z][\\w-]*\\b[^>]*\\bid="${id}"[^>]*>)`, "i");
    return html.replace(tagPattern, (tag) => {
        const escaped = escapeHtml(value);
        const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`, "i");
        return attributePattern.test(tag)
            ? tag.replace(attributePattern, () => `${attribute}="${escaped}"`)
            : tag.replace(/>$/, ` ${attribute}="${escaped}">`);
    });
}

function projectLink(project) {
    return `/projets/${projectSlug(project)}/`;
}

function renderProjectMenu(projects) {
    return projects.map((project) =>
        `<li><a href="${projectLink(project)}">${escapeHtml(project.name)}</a></li>`
    ).join("");
}

function renderProjectMiniatures(projects, currentIndex) {
    return projects.map((project, index) => {
        if (index === currentIndex) return "";
        return `<a href="${projectLink(project)}" class="miniature"><img src="/images/${encodeURIComponent(project.image)}" alt="" loading="lazy"><h4>${escapeHtml(project.name)}</h4><span>${escapeHtml(`${project.category} / ${project.type}`)}</span><p>${escapeHtml(plainText(project.summaryHtml))}</p></a>`;
    }).join("");
}

function renderSkillCards(skills) {
    return skills.map((skill) =>
        `<article class="competence-item skill-card"><span class="skill-index">${escapeHtml(skill.eyebrow)}</span><h3>${escapeHtml(skill.title)}</h3><p>${escapeHtml(skill.description)}</p><ul class="skill-tools">${skill.tools.map((tool) => `<li>${escapeHtml(tool)}</li>`).join("")}</ul></article>`
    ).join("");
}

function renderTraits(traits) {
    const menu = traits.map((trait, index) =>
        `<a href="#presentation" data-content="${index}" aria-label="${escapeHtml(trait.label)}"><img src="/images/${encodeURIComponent(trait.image)}" alt="${escapeHtml(trait.label)}" class="menu-logo"></a>`
    ).join("");
    return {
        menu,
        message: traits.length ? `<p>${escapeHtml(traits[0].description)}</p>` : ""
    };
}

function renderPortrait(items) {
    return items.map((item, index) =>
        `<div class="portrait-item"><div class="portrait-icon"><span aria-hidden="true">${String(index + 1).padStart(2, "0")}</span></div><p class="portrait-question">${escapeHtml(item.question)}</p><p class="portrait-answer">${escapeHtml(item.answer)}</p></div>`
    ).join("");
}

function renderInfluences(items) {
    return items.map((item) =>
        `<div class="influence-card" role="button" tabindex="0" aria-pressed="false" aria-label="Découvrir l'influence de ${escapeHtml(item.name)}"><div class="influence-front"><img src="/images/${encodeURIComponent(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy"><h3>${escapeHtml(item.name)}</h3></div><div class="influence-back"><p>${escapeHtml(item.description)}</p></div></div>`
    ).join("");
}

function renderSiteHtml(html, pathname, projects, site, selectedIndex) {
    html = replaceElementContents(html, "projets-menu", renderProjectMenu(projects));
    if (pathname === "/" || pathname === "/index.html") {
        const profile = site.profile;
        const contact = site.contact;
        html = replaceDataSiteContents(html, "name", escapeHtml(profile.name));
        html = replaceDataSiteContents(html, "kicker", escapeHtml(profile.kicker));
        html = replaceDataSiteContents(html, "headline", escapeHtml(profile.headline).replace(/\r?\n/g, "<br>"));
        html = replaceDataSiteContents(html, "cardSubtitle", escapeHtml(profile.cardSubtitle));
        html = replaceDataSiteContents(html, "cardFocus", escapeHtml(profile.cardFocus));
        html = replaceDataSiteContents(html, "statement", escapeHtml(profile.statement));
        html = replaceDataSiteContents(html, "biography", escapeHtml(profile.biography));
        html = replaceDataSiteContents(html, "traitsCaption", escapeHtml(profile.traitsCaption));
        html = replaceElementContents(html, "skills-list", renderSkillCards(site.skills));
        html = replaceElementContents(html, "portrait-list", renderPortrait(site.portrait));
        html = replaceElementContents(html, "influences-list", renderInfluences(site.influences));
        const traits = renderTraits(site.traits);
        html = replaceElementContents(html, "menu", traits.menu);
        html = replaceElementContents(html, "trait-message", traits.message);
        html = replaceDataSiteContents(html, "phone", escapeHtml(contact.phone));
        html = replaceDataSiteContents(html, "contactNote", escapeHtml(contact.note));
        html = html.replace(/(<a\b[^>]*\bdata-contact-email\b[^>]*>)[\s\S]*?(<\/a>)/i, (match, opening, closing) =>
            `${opening.replace(/\bhref="[^"]*"/i, `href="mailto:${escapeHtml(contact.email)}"`)}${escapeHtml(contact.email)}${closing}`
        );
        html = html.replace(/(<a\b[^>]*\bdata-contact-youtube\b[^>]*>)[\s\S]*?(<\/a>)/i, (match, opening, closing) =>
            contact.youtube
                ? `${opening.replace(/\bhref="[^"]*"/i, `href="${escapeHtml(contact.youtube)}"`)}Ma chaîne YouTube${closing}`
                : `${opening.replace(/>/, " hidden>")}Ma chaîne YouTube${closing}`
        );

        const firstProject = projects[0];
        if (firstProject) {
            html = setElementAttribute(html, "home-project-image", "src", `/images/${firstProject.image}`);
            html = setElementAttribute(html, "home-project-image", "alt", `Projet ${firstProject.name} de ${profile.name}`);
            html = setElementAttribute(html, "home-project-link", "href", projectLink(firstProject));
            html = replaceElementContents(html, "home-project-tags",
                [firstProject.category, firstProject.type].map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")
            );
            html = replaceElementContents(html, "home-project-summary", escapeHtml(plainText(firstProject.summaryHtml)));
        } else {
            html = replaceElementContents(html, "home-project-tags", "");
            html = replaceElementContents(html, "home-project-summary", "Aucun projet n’est publié pour le moment.");
            html = setElementAttribute(html, "home-project-image", "hidden", "");
            html = setElementAttribute(html, "home-project-link", "hidden", "");
        }
        return html;
    }

    if (selectedIndex !== null && projects[selectedIndex]) {
        const project = projects[selectedIndex];
        const previous = projects[(selectedIndex - 1 + projects.length) % projects.length];
        const next = projects[(selectedIndex + 1) % projects.length];
        html = replaceElementContents(html, "project-title", escapeHtml(project.name));
        html = replaceElementContents(html, "project-date", escapeHtml(project.date));
        html = replaceElementContents(html, "project-description", project.descriptionHtml);
        html = replaceElementContents(html, "tags-list", project.technologies.map((technology) =>
            `<li>${escapeHtml(technology)}</li>`
        ).join(""));
        html = replaceElementContents(html, "project-counter", `${selectedIndex + 1} / ${projects.length}`);
        html = replaceElementContents(html, "project-counter-label", String(selectedIndex + 1).padStart(2, "0"));
        html = setElementAttribute(html, "project-image", "src", `/images/${project.image}`);
        html = setElementAttribute(html, "project-image", "alt", `Projet ${project.name} de ${site.profile.name}`);
        html = setElementAttribute(html, "previous-project", "href", projectLink(previous));
        html = setElementAttribute(html, "next-project", "href", projectLink(next));
        html = replaceElementContents(html, "miniatures-grid", renderProjectMiniatures(projects, selectedIndex));
    }
    return html;
}

async function buildSeoHtml(html, pathname, searchParams, projectIndex) {
    if (!["/", "/index.html", "/projets.html"].includes(pathname) && projectIndex === null) return html;
    const site = await readSiteContent();
    const projects = await readProjects();
    let selectedIndex = projectIndex;
    if (selectedIndex === null && pathname === "/projets.html" && projects.length) {
        const requested = Number.parseInt(searchParams.get("compteur") ?? "0", 10);
        selectedIndex = Number.isInteger(requested) && requested >= 0 && requested < projects.length ? requested : 0;
    }

    const personName = site.profile.name;
    let title = `${personName} | Développeur web junior — Portfolio`;
    let description = metaDescription(plainText(site.profile.biography));
    let image = `${SITE_URL}/images/photo-profil.webp`;
    let canonical = `${SITE_URL}/`;
    let schema = {
        "@context": "https://schema.org",
        "@type": "Person",
        name: personName,
        jobTitle: "Étudiant en développement web — BUT MMI",
        description: plainText(site.profile.biography),
        knowsAbout: [...new Set(site.skills.flatMap((skill) => skill.tools))],
        sameAs: site.contact.youtube ? [site.contact.youtube] : []
    };
    if (SITE_URL) schema.url = `${SITE_URL}/`;

    if (selectedIndex !== null && projects[selectedIndex]) {
        const project = projects[selectedIndex];
        const slug = projectSlug(project);
        title = `${project.name} | Projet — Portfolio de ${personName}`;
        description = metaDescription(plainText(project.summaryHtml) || plainText(project.descriptionHtml));
        image = `${SITE_URL}/images/${encodeURIComponent(project.image)}`;
        canonical = `${SITE_URL}/projets/${slug}/`;
        schema = {
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            name: project.name,
            description: plainText(project.descriptionHtml).slice(0, 1000),
            image,
            dateCreated: project.date,
            keywords: [...project.technologies, project.category, project.type].join(", "),
            author: { "@type": "Person", name: personName },
            ...(SITE_URL ? { url: canonical } : {})
        };
    }

    html = renderSiteHtml(html, pathname, projects, site, selectedIndex);
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
    html = setMetaContent(html, "page-description", description);
    html = setMetaContent(html, "og-title", title);
    html = setMetaContent(html, "og-description", description);
    html = setMetaContent(html, "twitter-title", title);
    html = setMetaContent(html, "twitter-description", description);
    html = setMetaContent(html, "og-image", image);
    if (SITE_URL) {
        html = setMetaContent(html, "og-url", canonical);
        html = setMetaContent(html, "canonical-url", canonical);
    } else {
        html = html.replace(/<link\b[^>]*\bid="canonical-url"[^>]*>/i, "");
        html = html.replace(/<meta\b[^>]*\bid="og-url"[^>]*>/i, "");
        html = setMetaContent(html, "og-image", selectedIndex === null
            ? "/images/photo-profil.webp"
            : `/images/${encodeURIComponent(projects[selectedIndex].image)}`);
    }
    html = html.replace(/(<script\b[^>]*\bid="portfolio-schema"[^>]*>)[\s\S]*?(<\/script>)/i, (match, opening, closing) =>
        `${opening}${JSON.stringify(schema).replace(/</g, "\\u003c")}${closing}`
    );
    return html;
}

function validateText(value, label, maxLength) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        const error = new Error(`${label} is required and must be at most ${maxLength} characters.`);
        error.status = 400;
        throw error;
    }
    return value.trim();
}

function validateOptionalText(value, label, maxLength) {
    if (typeof value !== "string" || value.trim().length > maxLength) {
        const error = new Error(`${label} must be at most ${maxLength} characters.`);
        error.status = 400;
        throw error;
    }
    return value.trim();
}

function validateNewProject(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        const error = new Error("Project data must be a JSON object.");
        error.status = 400;
        throw error;
    }
    const name = validateText(input.name, "Name", 120);
    const date = validateText(input.date, "Date", 200);
    const category = validateText(input.category, "Category", 60);
    const type = validateText(input.type, "Type", 60);
    const summary = validateText(input.summary, "Summary", 500);
    const description = validateText(input.description, "Description", 10000);
    if (input.links !== undefined && !Array.isArray(input.links)) {
        const error = new Error("Project links must be provided as a list.");
        error.status = 400;
        throw error;
    }
    const links = input.links ?? [];
    if (links.length > 10) {
        const error = new Error("A project can have at most 10 links.");
        error.status = 400;
        throw error;
    }
    const validatedLinks = links.map((link) => {
        if (!link || typeof link !== "object" || Array.isArray(link)) {
            const error = new Error("Project links must contain a label and URL.");
            error.status = 400;
            throw error;
        }
        const label = validateText(link.label, "Link label", 100);
        const url = validateText(link.url, "Link URL", 1000);
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            const error = new Error("Project links must be valid HTTP or HTTPS URLs.");
            error.status = 400;
            throw error;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            const error = new Error("Project links must use HTTP or HTTPS.");
            error.status = 400;
            throw error;
        }
        return { label, url };
    });

    if (!Array.isArray(input.technologies) || input.technologies.length < 1 || input.technologies.length > 8) {
        const error = new Error("Enter between 1 and 8 technologies.");
        error.status = 400;
        throw error;
    }
    const technologies = input.technologies.map((technology) => validateText(technology, "Technology", 50));
    if (input.imageData !== undefined && typeof input.imageData !== "string") {
        const error = new Error("Choose an image for the project.");
        error.status = 400;
        throw error;
    }

    return {
        name,
        date,
        category,
        type,
        summary,
        description,
        links: validatedLinks,
        technologies,
        imageData: input.imageData
    };
}

function decodeImage(imageData) {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
    if (!match) {
        const error = new Error("Use a JPEG, PNG, or WebP image.");
        error.status = 400;
        throw error;
    }

    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        const error = new Error("The image must be smaller than 5 MB.");
        error.status = 400;
        throw error;
    }

    const validSignature = extension === "jpg"
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : extension === "png"
            ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.toString("ascii", 0, 4) === "RIFF"
                && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!validSignature) {
        const error = new Error("The selected file is not a valid image.");
        error.status = 400;
        throw error;
    }
    return { bytes, extension };
}

async function readProjects() {
    const data = await fs.readFile(PROJECTS_FILE, "utf8");
    const projects = JSON.parse(data);
    if (!Array.isArray(projects)) throw new Error("Project data must be a JSON array.");
    return projects;
}

async function readSiteContent() {
    const data = await fs.readFile(SITE_FILE, "utf8");
    const content = JSON.parse(data);
    if (!content || typeof content !== "object" || Array.isArray(content)) {
        throw new Error("Site content must be a JSON object.");
    }
    return content;
}

async function writeJsonFile(file, value) {
    const temporaryFile = path.join(path.dirname(file), `.content-${crypto.randomUUID()}.tmp`);
    try {
        await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
        await fs.rename(temporaryFile, file);
    } catch (error) {
        await fs.rm(temporaryFile, { force: true });
        throw error;
    }
}

function writeJson(file, value) {
    const operation = writeQueue.then(() => writeJsonFile(file, value));
    writeQueue = operation.catch(() => {});
    return operation;
}

function mutateProjects(mutator) {
    const operation = writeQueue.then(async () => {
        const projects = await readProjects();
        const result = await mutator(projects);
        await writeJsonFile(PROJECTS_FILE, projects);
        return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
}

function validateSiteContent(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        const error = new Error("Site content must be a JSON object.");
        error.status = 400;
        throw error;
    }
    const requiredArray = (value, label, min, max, mapper) => {
        if (!Array.isArray(value) || value.length < min || value.length > max) {
            const error = new Error(`${label} must contain between ${min} and ${max} entries.`);
            error.status = 400;
            throw error;
        }
        return value.map(mapper);
    };
    const objectEntry = (item, label) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            const error = new Error(`${label} entries must be objects.`);
            error.status = 400;
            throw error;
        }
        return item;
    };
    const profile = input.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        const error = new Error("Profile content is missing.");
        error.status = 400;
        throw error;
    }

    const skills = requiredArray(input.skills, "Skills", 0, 16, (entry) => {
        const item = objectEntry(entry, "Skills");
        return {
            eyebrow: validateText(item.eyebrow, "Skill category", 80),
            title: validateText(item.title, "Skill title", 100),
            description: validateText(item.description, "Skill description", 500),
            tools: requiredArray(item.tools, "Skill tools", 0, 12, (tool) => validateText(tool, "Tool", 50))
        };
    });
    const traits = requiredArray(input.traits, "Traits", 0, 8, (entry) => {
        const item = objectEntry(entry, "Traits");
        return {
            label: validateText(item.label, "Trait label", 60),
            description: validateText(item.description, "Trait description", 500),
            image: validateImageName(item.image)
        };
    });
    const portrait = requiredArray(input.portrait, "Portrait answers", 0, 12, (entry) => {
        const item = objectEntry(entry, "Portrait answers");
        return {
            question: validateText(item.question, "Portrait question", 120),
            answer: validateText(item.answer, "Portrait answer", 500)
        };
    });
    const influences = requiredArray(input.influences, "Influences", 0, 8, (entry) => {
        const item = objectEntry(entry, "Influences");
        return {
            name: validateText(item.name, "Influence name", 100),
            image: validateImageName(item.image),
            description: validateText(item.description, "Influence description", 1000)
        };
    });
    const theme = {};
    for (const mode of ["light", "dark"]) {
        if (!input.theme || !input.theme[mode]) {
            const error = new Error(`The ${mode} theme is missing.`);
            error.status = 400;
            throw error;
        }
        theme[mode] = {};
        for (const key of ["background", "text", "primary", "secondary", "accent", "border", "shadow", "editorial"]) {
            const value = input.theme[mode][key];
            if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
                const error = new Error(`Theme color ${mode}.${key} must be a six-digit hex color.`);
                error.status = 400;
                throw error;
            }
            theme[mode][key] = value;
        }
    }
    const youtube = typeof input.contact?.youtube === "string" ? input.contact.youtube.trim() : "";
    if (youtube) {
        let parsed;
        try {
            parsed = new URL(youtube);
        } catch {
            const error = new Error("YouTube URL must be a valid HTTP or HTTPS URL.");
            error.status = 400;
            throw error;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            const error = new Error("YouTube URL must use HTTP or HTTPS.");
            error.status = 400;
            throw error;
        }
    }
    const email = validateText(input.contact?.email, "Contact email", 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const error = new Error("Contact email must be a valid email address.");
        error.status = 400;
        throw error;
    }

    return {
        profile: {
            name: validateText(profile.name, "Name", 120),
            kicker: validateText(profile.kicker, "Profile kicker", 160),
            headline: validateText(profile.headline, "Headline", 180),
            cardSubtitle: validateText(profile.cardSubtitle, "Profile subtitle", 120),
            cardFocus: validateText(profile.cardFocus, "Profile focus", 120),
            statement: validateText(profile.statement, "Profile statement", 180),
            biography: validateText(profile.biography, "Biography", 2000),
            traitsCaption: validateText(profile.traitsCaption, "Traits caption", 180)
        },
        skills,
        traits,
        portrait,
        influences,
        contact: {
            email,
            phone: validateOptionalText(input.contact?.phone, "Contact phone", 60),
            note: validateText(input.contact?.note, "Contact note", 500),
            youtube
        },
        theme
    };
}

function validateImageName(value) {
    if (typeof value !== "string" || !/^[\w.-]+\.(?:webp|svg|png|jpe?g)$/i.test(value) || value.includes("..")) {
        const error = new Error("Choose a valid image from the images folder.");
        error.status = 400;
        throw error;
    }
    return value;
}

async function createProject(input, existingImage, existingSlug) {
    const data = validateNewProject(input);
    let imageName = existingImage;
    if (data.imageData) {
        const image = decodeImage(data.imageData);
        imageName = `${crypto.randomUUID()}.${image.extension}`;
        await fs.writeFile(path.join(IMAGE_DIRECTORY, imageName), image.bytes, { flag: "wx" });
    } else if (!imageName) {
        const error = new Error("Choose an image for the project.");
        error.status = 400;
        throw error;
    }

    const descriptionHtml = escapeHtml(data.description).replace(/\r?\n/g, "<br><br>");
    const linkHtml = data.links.map((link) =>
        `<br><br><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`
    ).join("");
    return {
        project: {
            image: imageName,
            name: data.name,
            slug: existingSlug || slugifyProjectName(data.name),
            descriptionHtml: `${descriptionHtml}${linkHtml}`,
            date: data.date,
            technologies: data.technologies,
            category: data.category,
            type: data.type,
            summaryHtml: escapeHtml(data.summary)
        },
        imageName: data.imageData ? imageName : null
    };
}

function checkLoginLimit(request, response) {
    const ip = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = loginAttempts.get(ip);
    if (!current || current.resetAt <= now) {
        loginAttempts.set(ip, { count: 0, resetAt: now + 15 * 60 * 1000 });
    }
    const attempts = loginAttempts.get(ip);
    if (attempts.count >= 5) {
        sendJson(response, 429, { error: "Too many login attempts. Try again later." }, {
            "Retry-After": String(Math.ceil((attempts.resetAt - now) / 1000))
        });
        return null;
    }
    return { ip, attempts };
}

async function handleApi(request, response, pathname) {
    if (pathname === "/api/admin/login" && request.method === "POST") {
        if (!hasSameOrigin(request)) {
            sendJson(response, 403, { error: "Request origin was rejected." });
            return;
        }
        const attempt = checkLoginLimit(request, response);
        if (!attempt) return;

        const body = await readJson(request);
        const password = typeof body.password === "string" ? body.password : "";
        if (password.length > 1024) {
            attempt.attempts.count += 1;
            sendJson(response, 401, { error: "Incorrect password." });
            return;
        }
        const suppliedDigest = crypto.scryptSync(password, Buffer.from(passwordSalt, "hex"), 64);
        if (!crypto.timingSafeEqual(suppliedDigest, expectedPasswordDigest)) {
            attempt.attempts.count += 1;
            sendJson(response, 401, { error: "Incorrect password." });
            return;
        }

        loginAttempts.delete(attempt.ip);
        const sessionId = crypto.randomBytes(32).toString("base64url");
        sessions.set(sessionId, Date.now() + SESSION_DURATION_MS);
        sendJson(response, 200, { authenticated: true }, {
            "Set-Cookie": `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
        });
        return;
    }

    if (pathname === "/api/admin/session" && request.method === "GET") {
        const sessionId = getSession(request);
        sendJson(response, 200, sessionId
            ? { authenticated: true, csrfToken: csrfToken(sessionId) }
            : { authenticated: false });
        return;
    }

    if (pathname.startsWith("/api/admin/")) {
        const sessionId = getSession(request);
        if (!sessionId) {
            sendJson(response, 401, { error: "Authentication required." });
            return;
        }
        if (request.method !== "GET" && (!hasSameOrigin(request) || !hasValidCsrf(request, sessionId))) {
            sendJson(response, 403, { error: "Request verification failed." });
            return;
        }

        if (pathname === "/api/admin/logout" && request.method === "POST") {
            sessions.delete(sessionId);
            sendJson(response, 200, { authenticated: false }, { "Set-Cookie": cookieOptions(0) });
            return;
        }

        if (pathname === "/api/admin/projects" && request.method === "GET") {
            sendJson(response, 200, await readProjects());
            return;
        }

        if (pathname === "/api/admin/site" && request.method === "GET") {
            sendJson(response, 200, await readSiteContent());
            return;
        }

        if (pathname === "/api/admin/images" && request.method === "GET") {
            const names = await fs.readdir(IMAGE_DIRECTORY);
            sendJson(response, 200, names.filter((name) =>
                /^[\w.-]+\.(?:webp|svg|png|jpe?g)$/i.test(name) && !name.includes("..")
            ).sort());
            return;
        }

        if (pathname === "/api/admin/site" && request.method === "PUT") {
            const content = validateSiteContent(await readJson(request));
            const imageNames = [...content.traits, ...content.influences].map((item) => item.image);
            for (const name of new Set(imageNames)) {
                try {
                    await fs.access(path.join(IMAGE_DIRECTORY, name));
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                    const missingImage = new Error(`Image not found: ${name}`);
                    missingImage.status = 400;
                    throw missingImage;
                }
            }
            await writeJson(SITE_FILE, content);
            sendJson(response, 200, { saved: true });
            return;
        }

        if (pathname === "/api/admin/projects/reorder" && request.method === "POST") {
            const body = await readJson(request);
            if (!body || typeof body !== "object" || !Number.isInteger(body.from) || !Number.isInteger(body.to)) {
                const error = new Error("Project positions must be integers.");
                error.status = 400;
                throw error;
            }
            await mutateProjects((projects) => {
                if (body.from < 0 || body.from >= projects.length || body.to < 0 || body.to >= projects.length) {
                    const error = new Error("Project position is out of range.");
                    error.status = 400;
                    throw error;
                }
                const [project] = projects.splice(body.from, 1);
                projects.splice(body.to, 0, project);
            });
            sendJson(response, 200, { saved: true });
            return;
        }

        if (pathname === "/api/admin/projects" && request.method === "POST") {
            const body = await readJson(request);
            const created = await createProject(body);
            try {
                await mutateProjects((projects) => {
                    assertUniqueProjectSlug(projects, created.project);
                    projects.push(created.project);
                });
            } catch (error) {
                if (created.imageName) await fs.rm(path.join(IMAGE_DIRECTORY, created.imageName), { force: true });
                throw error;
            }
            sendJson(response, 201, { saved: true, name: created.project.name });
            return;
        }

        const projectMatch = /^\/api\/admin\/projects\/(\d+)$/.exec(pathname);
        if (projectMatch && (request.method === "PUT" || request.method === "DELETE")) {
            const index = Number.parseInt(projectMatch[1], 10);
            if (request.method === "DELETE") {
                await mutateProjects((projects) => {
                    if (index >= projects.length) {
                        const error = new Error("Project not found.");
                        error.status = 404;
                        throw error;
                    }
                    projects.splice(index, 1);
                });
                sendJson(response, 200, { deleted: true });
                return;
            }
            const body = await readJson(request);
            let updatedImage = null;
            try {
                const updated = await mutateProjects(async (projects) => {
                    if (index >= projects.length) {
                        const error = new Error("Project not found.");
                        error.status = 404;
                        throw error;
                    }
                    const result = await createProject(
                        body,
                        projects[index].image,
                        projects[index].slug || slugifyProjectName(projects[index].name)
                    );
                    assertUniqueProjectSlug(projects, result.project, index);
                    updatedImage = result.imageName;
                    projects[index] = result.project;
                    return result;
                });
                sendJson(response, 200, { saved: true, name: updated.project.name });
            } catch (error) {
                if (updatedImage) await fs.rm(path.join(IMAGE_DIRECTORY, updatedImage), { force: true });
                throw error;
            }
            return;
        }

        sendJson(response, 404, { error: "Admin endpoint not found." });
        return;
    }

    sendJson(response, 404, { error: "API endpoint not found." });
}

const publicFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/projets.html", ["projets.html", "text/html; charset=utf-8"]],
    ["/admin/", ["admin/index.html", "text/html; charset=utf-8"]],
    ["/admin/index.html", ["admin/index.html", "text/html; charset=utf-8"]],
    ["/css/style.css", ["css/style.css", "text/css; charset=utf-8"]],
    ["/css/admin.css", ["css/admin.css", "text/css; charset=utf-8"]],
    ["/scripts/site.js", ["scripts/site.js", "text/javascript; charset=utf-8"]],
    ["/scripts/accueil.js", ["scripts/accueil.js", "text/javascript; charset=utf-8"]],
    ["/scripts/projets.js", ["scripts/projets.js", "text/javascript; charset=utf-8"]],
    ["/scripts/banniere.js", ["scripts/banniere.js", "text/javascript; charset=utf-8"]],
    ["/scripts/admin.js", ["scripts/admin.js", "text/javascript; charset=utf-8"]],
    ["/scripts/site-content.js", ["scripts/site-content.js", "text/javascript; charset=utf-8"]],
    ["/scripts/project-url.js", ["scripts/project-url.js", "text/javascript; charset=utf-8"]],
    ["/data/projets.json", ["data/projets.json", "application/json; charset=utf-8"]],
    ["/data/site.json", ["data/site.json", "application/json; charset=utf-8"]]
]);

async function serveRobots(response) {
    const lines = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/"
    ];
    if (SITE_URL) lines.push(`Sitemap: ${SITE_URL}/sitemap.xml`);
    response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(`${lines.join("\n")}\n`);
}

async function serveSitemap(response) {
    if (!SITE_URL) {
        response.writeHead(503, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex"
        });
        response.end("Configure SITE_URL with the public HTTPS domain to enable the sitemap.\n");
        return;
    }

    const projects = await readProjects();
    const urls = [`${SITE_URL}/`, ...projects.map((project) =>
        `${SITE_URL}/projets/${projectSlug(project)}/`
    )];
    const lastModified = (await fs.stat(PROJECTS_FILE)).mtime.toISOString().slice(0, 10);
    const entries = urls.map((url) =>
        `  <url>\n    <loc>${xmlEscape(url)}</loc>\n    <lastmod>${lastModified}</lastmod>\n  </url>`
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
    response.writeHead(200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(xml);
}

function addSecurityHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

async function serveStatic(request, response, requestUrl) {
    const { pathname } = requestUrl;
    if (pathname === "/robots.txt") {
        await serveRobots(response);
        return;
    }
    if (pathname === "/sitemap.xml") {
        await serveSitemap(response);
        return;
    }

    let selectedProjectIndex = null;
    const projectRoute = /^\/projets\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (projectRoute) {
        const projects = await readProjects();
        selectedProjectIndex = projects.findIndex((project) => projectSlug(project) === projectRoute[1]);
        if (selectedProjectIndex < 0) {
            response.writeHead(404).end("Not found");
            return;
        }
    }

    const publicFile = projectRoute
        ? ["projets.html", "text/html; charset=utf-8"]
        : publicFiles.get(pathname);
    let filename;
    let contentType;
    if (publicFile) {
        [filename, contentType] = publicFile;
    } else if (pathname.startsWith("/images/")) {
        const imageName = pathname.slice("/images/".length);
        if (!/^[\w.-]+\.(?:webp|svg|png|jpe?g)$/i.test(imageName) || imageName.includes("..")) {
            response.writeHead(404).end("Not found");
            return;
        }
        filename = path.join("images", imageName);
        contentType = imageName.toLowerCase().endsWith(".svg")
            ? "image/svg+xml"
            : imageName.toLowerCase().endsWith(".png")
                ? "image/png"
                : imageName.toLowerCase().endsWith(".jpg") || imageName.toLowerCase().endsWith(".jpeg")
                    ? "image/jpeg"
                    : "image/webp";
    } else {
        response.writeHead(404).end("Not found");
        return;
    }

    const filePath = path.resolve(ROOT, filename);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(404).end("Not found");
        return;
    }
    try {
        let data = await fs.readFile(filePath);
        if (contentType.startsWith("text/html")) {
            data = Buffer.from(await buildSeoHtml(data.toString("utf8"), pathname, requestUrl.searchParams, selectedProjectIndex));
        }
        response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": pathname.startsWith("/data/") || contentType.startsWith("text/html")
                ? "no-cache"
                : "public, max-age=3600"
        });
        response.end(request.method === "HEAD" ? undefined : data);
    } catch (error) {
        if (error.code === "ENOENT") {
            response.writeHead(404).end("Not found");
            return;
        }
        throw error;
    }
}

const server = http.createServer(async (request, response) => {
    addSecurityHeaders(response);
    try {
        const requestUrl = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
        if (requestUrl.pathname.startsWith("/api/")) {
            await handleApi(request, response, requestUrl.pathname);
            return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
            return;
        }
        await serveStatic(request, response, requestUrl);
    } catch (error) {
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        if (error.status) {
            sendJson(response, error.status, { error: error.message });
            return;
        }
        console.error("Request failed:", error);
        sendJson(response, 500, { error: "An internal server error occurred." });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Portfolio listening on http://${HOST}:${PORT}`);
});
