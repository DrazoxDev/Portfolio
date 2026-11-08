const contactForm = document.getElementById("contact-form");
if (contactForm) {
    contactForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(contactForm);
        const subject = `Message portfolio de ${formData.get("prenom")} ${formData.get("nom")}`;
        const body = `${formData.get("message")}\n\nE-mail : ${formData.get("email")}`;
        const status = document.getElementById("contact-status");
        if (status) {
            status.textContent = "Votre application de messagerie va s'ouvrir pour envoyer le message.";
        }
        const address = document.querySelector("[data-contact-email]")?.textContent ?? "";
        window.location.href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
}

async function loadHomeProjects() {
    const menu = document.getElementById("projets-menu");
    const card = document.querySelector(".projet-card-carousel");
    const indicator = document.querySelector(".indicator-text");
    if (!menu || !card || !indicator) return;

    try {
        const response = await fetch("/data/projets.json");
        if (!response.ok) {
            throw new Error(`Chargement des projets impossible (${response.status}).`);
        }
        const projects = await response.json();
        if (!Array.isArray(projects)) {
            throw new Error("Le fichier JSON ne contient aucun projet.");
        }
        if (projects.length === 0) {
            const message = document.createElement("p");
            message.textContent = "Aucun projet n’est publié pour le moment.";
            card.replaceChildren(message);
            document.querySelectorAll(".carousel-btn").forEach((button) => { button.disabled = true; });
            indicator.textContent = "0 / 0";
            return;
        }

        menu.replaceChildren();
        projects.forEach((project, index) => {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.href = window.portfolioProjectUrl(project);
            link.textContent = project.name;
            item.appendChild(link);
            menu.appendChild(item);
        });

        let currentIndex = 0;
        const renderProject = () => {
            const project = projects[currentIndex];
            const image = card.querySelector(".projet-image-carousel img");
            const tags = card.querySelector(".tags");
            const description = card.querySelector(".description");
            const detailsLink = card.querySelector(".voir-plus");

            image.src = `/images/${project.image}`;
            image.alt = project.name;
            tags.replaceChildren();
            [project.category, project.type].forEach((tagText) => {
                const tag = document.createElement("span");
                tag.className = "tag";
                tag.textContent = tagText;
                tags.appendChild(tag);
            });
            description.innerHTML = project.summaryHtml;
            detailsLink.href = window.portfolioProjectUrl(project);
            indicator.textContent = `${currentIndex + 1} / ${projects.length}`;
        };

        document.querySelector(".carousel-btn.prev")?.addEventListener("click", () => {
            currentIndex = (currentIndex - 1 + projects.length) % projects.length;
            renderProject();
        });
        document.querySelector(".carousel-btn.next")?.addEventListener("click", () => {
            currentIndex = (currentIndex + 1) % projects.length;
            renderProject();
        });
        renderProject();
    } catch (error) {
        console.error("Erreur lors du chargement des projets :", error);
        const message = document.createElement("p");
        message.id = "project-load-error";
        message.setAttribute("role", "alert");
        message.textContent = "Les projets n'ont pas pu être chargés. Vérifiez que le site est servi par un serveur web.";
        card.replaceChildren(message);
    }
}

loadHomeProjects();
