export const DataManager = {
    /**
     * Handles the export of the application state to a JSON file.
     * @param {Object} state - The current application state.
     */
    async exportState(state) {
        const dataStr = JSON.stringify(state, null, 2);
        const fileName = `baonbuddy_backup_${new Date().toISOString().slice(0, 10)}.json`;

        alert("Recommendation: For better organization, we suggest creating a folder named 'SavingJson' to store your BaonBuddy backups!");

        // Use File System Access API if available (modern desktop browsers)
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{
                        description: 'JSON Backup File',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(dataStr);
                await writable.close();
                alert('Backup saved successfully!');
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Export failed:', err);
                    alert('Export failed. Please try again.');
                }
            }
        } else {
            // Fallback for mobile and older browsers
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', url);
            linkElement.setAttribute('download', fileName);
            document.body.appendChild(linkElement);
            linkElement.click();
            document.body.removeChild(linkElement);
            URL.revokeObjectURL(url);
            alert('Your browser is downloading the file to your default location.');
        }
    },

    /**
     * Handles the import of application state from a file or text area.
     * @param {HTMLInputElement} fileInput - The file input element.
     * @param {HTMLTextAreaElement} textArea - The text area element.
     * @returns {Promise<Object|null>} The parsed state object or null if failed.
     */
    async importState(fileInput, textArea) {
        let importedData = null;

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            try {
                const text = await file.text();
                importedData = JSON.parse(text);
            } catch (e) {
                alert('Invalid JSON file format.');
                return null;
            }
        } else if (textArea.value.trim() !== "") {
            try {
                importedData = JSON.parse(textArea.value);
            } catch (e) {
                alert('Invalid JSON text entered.');
                return null;
            }
        } else {
            alert('Please select a file or paste JSON text to import.');
            return null;
        }

        if (importedData) {
            if (!confirm('This will replace ALL your current data. Are you sure?')) return null;
            return importedData;
        }
        return null;
    }
};