async function loadProjectDetails() {
    const menu = document.getElementById("projets-menu");
    const miniatureGrid = document.getElementById("miniatures-grid");

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
            document.title = "Projets - Camille SORET";
            document.getElementById("project-title").textContent = "Aucun projet";
            document.getElementById("project-counter").textContent = "0 / 0";
            document.getElementById("project-counter-label").textContent = "—";
            document.getElementById("previous-project").hidden = true;
            document.getElementById("next-project").hidden = true;
            document.querySelector(".projet-image-container").hidden = true;
            document.getElementById("project-date").textContent = "";
            document.getElementById("project-description").textContent = "Aucun projet n’est publié pour le moment.";
            document.querySelector(".projet-tags").hidden = true;
            document.querySelector(".projet-miniatures").hidden = true;
            return;
        }

        const routeSlug = /^\/projets\/([a-z0-9-]+)\/?$/.exec(window.location.pathname)?.[1];
        const routeIndex = routeSlug
            ? projects.findIndex((item) => window.portfolioProjectSlug(item) === routeSlug)
            : -1;
        const requestedIndex = Number.parseInt(new URLSearchParams(window.location.search).get("compteur") ?? "0", 10);
        const currentIndex = routeIndex >= 0
            ? routeIndex
            : Number.isNaN(requestedIndex) || requestedIndex < 0 || requestedIndex >= projects.length
                ? 0
                : requestedIndex;
        const project = projects[currentIndex];

        const personName = document.querySelector(".nom")?.textContent.trim() || "Camille Soret";
        const title = `${project.name} | Projet — Portfolio de ${personName}`;
        const summary = document.createElement("div");
        summary.innerHTML = project.summaryHtml;
        const description = (summary.textContent || project.name).replace(/\s+/g, " ").trim().slice(0, 160);
        document.title = title;
        ["page-description", "og-description", "twitter-description"].forEach((id) => {
            document.getElementById(id)?.setAttribute("content", description);
        });
        ["og-title", "twitter-title"].forEach((id) => {
            document.getElementById(id)?.setAttribute("content", title);
        });
        document.getElementById("project-title").textContent = project.name;
        document.getElementById("project-counter").textContent = `${currentIndex + 1} / ${projects.length}`;
        document.getElementById("project-counter-label").textContent =
            String(currentIndex + 1).padStart(2, "0");

        const previousIndex = (currentIndex - 1 + projects.length) % projects.length;
        const nextIndex = (currentIndex + 1) % projects.length;
        document.getElementById("previous-project").href = window.portfolioProjectUrl(projects[previousIndex]);
        document.getElementById("next-project").href = window.portfolioProjectUrl(projects[nextIndex]);

        const image = document.getElementById("project-image");
        image.src = `/images/${project.image}`;
        image.alt = project.name;
        document.getElementById("project-date").textContent = project.date;
        document.getElementById("project-description").innerHTML = project.descriptionHtml;
        const socialImage = `${window.location.origin}/images/${encodeURIComponent(project.image)}`;
        document.getElementById("og-image")?.setAttribute("content", socialImage);

        const technologyList = document.querySelector(".tags-list");
        technologyList.replaceChildren();
        project.technologies.forEach((technology) => {
            const item = document.createElement("li");
            item.textContent = technology;
            technologyList.appendChild(item);
        });

        menu.replaceChildren();
        miniatureGrid.replaceChildren();
        projects.forEach((item, index) => {
            const menuItem = document.createElement("li");
            const menuLink = document.createElement("a");
            menuLink.href = window.portfolioProjectUrl(item);
            menuLink.textContent = item.name;
            menuItem.appendChild(menuLink);
            menu.appendChild(menuItem);

            if (index !== currentIndex) {
                const miniature = document.createElement("a");
                miniature.href = window.portfolioProjectUrl(item);
                miniature.className = "miniature";
                const thumbnail = document.createElement("img");
                thumbnail.src = `/images/${item.image}`;
                thumbnail.alt = "";
                thumbnail.loading = "lazy";
                const title = document.createElement("h4");
                title.textContent = item.name;
                const category = document.createElement("span");
                category.textContent = `${item.category} / ${item.type}`;
                const summary = document.createElement("p");
                const summaryContent = document.createElement("div");
                summaryContent.innerHTML = item.summaryHtml;
                summary.textContent = summaryContent.textContent;
                miniature.append(thumbnail, title, category, summary);
                miniatureGrid.appendChild(miniature);
            }
        });
    } catch (error) {
        console.error("Erreur lors du chargement du projet :", error);
        const content = document.querySelector(".projet-info");
        const message = document.createElement("p");
        message.setAttribute("role", "alert");
        message.textContent = "Le projet n'a pas pu être chargé. Vérifiez que le site est servi par un serveur web.";
        content.prepend(message);
    }
}

loadProjectDetails();
